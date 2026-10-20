import type { Capability } from '../contracts/capability.ts';
import type { DecideOptions, Model } from '../contracts/model.ts';
import type { ReasoningRequest, Transport, TransportReply, TransportRequest } from '../contracts/transport.ts';
import { type Decision, optionsOf, type Question } from '../schemas/decision.ts';
import type { Answer, Result, Run, Usage } from '../schemas/result.ts';
import { effectiveCapabilities } from '../services/capabilities.ts';
import { callCost, type Pricing } from '../services/costs.ts';
import { isAbort, messageOf } from '../services/errors.ts';
import { argmax } from '../services/metrics.ts';
import { pool } from '../services/pool.ts';
import { distributionFromLogprobs } from './logprobs.ts';
import { buildMessages, parseAnswer, readsLogprobs } from './prompts.ts';

export type ReasoningProfile = { mandatory: boolean; effort: string };

export type ModelProfile = { temperature: boolean; seed: boolean; reasoning: ReasoningProfile | null };

export type ChatModelConfig = {
  id: string;
  version: string;
  capabilities: readonly Capability[];
  transport: Transport;
  profile?: ModelProfile;
  pricing?: Pricing | null;
};

type Settings = Required<Omit<DecideOptions, 'signal' | 'onCall'>> & Pick<DecideOptions, 'signal' | 'onCall'>;

const DEFAULT_PROFILE: ModelProfile = { temperature: true, seed: true, reasoning: null };
const DEFAULT_SETTINGS = { samples: 10, seed: 0, reasoning: false, concurrency: 4 };
const DISABLED_REASONING: ReasoningRequest = { effort: 'none' };
const TOP_LOGPROBS = 20;
const LOGPROBS_MAX_TOKENS = 4;
const ANSWER_MAX_TOKENS = 16;
const REASONING_MAX_TOKENS = 4096;
const SAMPLING_TEMPERATURE = 1;
const GREEDY_TEMPERATURE = 0;

function now() {
  return performance.now();
}

function usageOf(replies: TransportReply[], pricing: Pricing | null): Usage {
  const costs = replies.map((reply) => callCost(reply, pricing)).filter((cost): cost is number => cost !== null);
  return {
    calls: replies.length,
    inputTokens: replies.reduce((sum, reply) => sum + (reply.usage?.inputTokens ?? 0), 0),
    outputTokens: replies.reduce((sum, reply) => sum + (reply.usage?.outputTokens ?? 0), 0),
    costUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
  };
}

function totalCost(answers: Answer[]): number | null {
  const costs = answers.map((answer) => answer.usage?.costUsd ?? null).filter((cost): cost is number => cost !== null);
  return costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null;
}

const STOPPED = Symbol('stopped');

type Outcome = TransportReply | Error | typeof STOPPED;

function settled(task: () => Promise<TransportReply>): () => Promise<Outcome> {
  return async () => {
    try {
      return await task();
    } catch (error) {
      if (isAbort(error)) return STOPPED;
      return error instanceof Error ? error : new Error(messageOf(error));
    }
  };
}

function isReply(outcome: Outcome): outcome is TransportReply {
  return outcome !== STOPPED && !(outcome instanceof Error);
}

function sampledDistribution(options: string[], runs: Run[]) {
  const answered = runs.map((run) => run.answer).filter((answer): answer is string => answer !== null);
  const counts = options.map((option) => answered.filter((answer) => answer === option).length);
  return {
    counts,
    distribution: options.map((option, index) => ({ option, probability: (counts[index] ?? 0) / answered.length })),
    valid: answered.length,
  };
}

export class ChatModel implements Model {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly Capability[];
  readonly transport: Transport;
  private readonly profile: ModelProfile;
  private readonly pricing: Pricing | null;

  constructor(config: ChatModelConfig) {
    this.id = config.id;
    this.version = config.version;
    this.capabilities = config.capabilities;
    this.transport = config.transport;
    this.profile = config.profile ?? DEFAULT_PROFILE;
    this.pricing = config.pricing ?? null;
  }

  usesLogprobs(question: Question): boolean {
    const canRead = effectiveCapabilities(this).includes('probabilities') && !this.profile.reasoning?.mandatory;
    return canRead && readsLogprobs(question);
  }

  async decide(decision: Decision, options: DecideOptions = {}): Promise<Result> {
    const settings: Settings = { ...DEFAULT_SETTINGS, ...options };
    const started = now();
    const answers: Answer[] = [];
    for (const question of decision.questions) {
      if (settings.signal?.aborted) break;
      try {
        answers.push(await this.answer(decision, question, settings));
      } catch (error) {
        if (isAbort(error)) break;
        return this.failed(messageOf(error), now() - started, totalCost(answers));
      }
    }
    return {
      status: settings.signal?.aborted ? 'stopped' : 'ok',
      model: { id: this.id, version: this.version },
      transport: { id: this.transport.id },
      answers,
      latencyMs: now() - started,
      costUsd: totalCost(answers),
    };
  }

  private answer(decision: Decision, question: Question, settings: Settings): Promise<Answer> {
    return this.usesLogprobs(question)
      ? this.readLogprobs(decision, question, settings)
      : this.sample(decision, question, settings);
  }

  private async readLogprobs(decision: Decision, question: Question, settings: Settings): Promise<Answer> {
    const request = this.request(decision, question, {
      ...this.temperature(GREEDY_TEMPERATURE),
      ...this.seed(settings.seed),
      ...(this.profile.reasoning ? { reasoning: DISABLED_REASONING } : {}),
      maxTokens: LOGPROBS_MAX_TOKENS,
      topLogprobs: TOP_LOGPROBS,
    });
    const reply = await this.call(request, settings);
    const reading = distributionFromLogprobs(reply.logprobs ?? [], question);
    if (!reading) throw new Error(`${question.id}: none of the top tokens is an allowed answer`);

    const options = optionsOf(question);
    const probabilities = reading.distribution.map((entry) => entry.probability);
    return {
      questionId: question.id,
      choice: options[argmax(probabilities)] ?? '',
      distribution: reading.distribution,
      source: 'logprobs',
      residualMass: reading.residualMass,
      usage: usageOf([reply], this.pricing),
      latencyMs: reply.latencyMs,
    };
  }

  private async sample(decision: Decision, question: Question, settings: Settings): Promise<Answer> {
    const started = now();
    const reasoning = this.reasoningRequest(settings.reasoning);
    const count = Math.max(1, settings.samples);
    const tasks = Array.from({ length: count }, (_, index) => () => {
      const request = this.request(decision, question, {
        ...this.temperature(SAMPLING_TEMPERATURE),
        ...this.seed(settings.seed + index),
        ...(reasoning ? { reasoning } : {}),
        maxTokens: reasoning && reasoning !== DISABLED_REASONING ? REASONING_MAX_TOKENS : ANSWER_MAX_TOKENS,
      });
      return this.call(request, settings);
    });
    const outcomes = (await pool(tasks.map(settled), settings.concurrency)).filter(
      (outcome): outcome is TransportReply | Error => outcome !== STOPPED,
    );
    const replies = outcomes.filter(isReply);
    const failure = outcomes.find((outcome): outcome is Error => outcome instanceof Error);

    const runs = outcomes.map((outcome) => this.runOf(outcome, question, settings));
    const options = optionsOf(question);
    const { counts, distribution, valid } = sampledDistribution(options, runs);
    if (!valid) {
      settings.signal?.throwIfAborted();
      throw failure && !replies.length ? failure : new Error(`${question.id}: no sampled reply was an allowed answer`);
    }

    return {
      questionId: question.id,
      choice: options[argmax(counts)] ?? '',
      distribution,
      source: 'sampled',
      runs,
      usage: usageOf(replies, this.pricing),
      latencyMs: now() - started,
    };
  }

  private runOf(outcome: TransportReply | Error, question: Question, settings: Settings): Run {
    if (outcome instanceof Error) return { answer: null, reasoning: null, error: messageOf(outcome) };
    return {
      answer: parseAnswer(outcome.text, question),
      reasoning: settings.reasoning ? (outcome.reasoning ?? null) : null,
    };
  }

  private request(
    decision: Decision,
    question: Question,
    parameters: Omit<TransportRequest, 'model' | 'messages'>,
  ): TransportRequest {
    return { model: this.id, messages: buildMessages(decision.input, question), ...parameters };
  }

  private temperature(value: number) {
    return this.profile.temperature ? { temperature: value } : {};
  }

  private seed(value: number) {
    return this.profile.seed ? { seed: value } : {};
  }

  private reasoningRequest(collect: boolean): ReasoningRequest | null {
    const reasoning = this.profile.reasoning;
    if (!reasoning) return null;
    if (collect || reasoning.mandatory) return { effort: reasoning.effort };
    return DISABLED_REASONING;
  }

  private async call(request: TransportRequest, settings: Settings): Promise<TransportReply> {
    settings.signal?.throwIfAborted();
    const reply = await this.transport.send(settings.signal ? { ...request, signal: settings.signal } : request);
    settings.onCall?.();
    return reply;
  }

  private failed(error: string, latencyMs: number, costUsd: number | null): Result {
    return {
      status: 'failed',
      model: { id: this.id, version: this.version },
      transport: { id: this.transport.id },
      error,
      answers: [],
      latencyMs,
      costUsd,
    };
  }
}
