import { describe, expect, it } from 'vitest';
import { ChatModel, DecisionSchema, parseResult, runDecision } from '../../src/index.ts';
import { scriptedTransport, textReply } from '../fakes/scripted-transport.ts';
import { buildDecision } from '../fixtures/decisions.ts';
import { buildAnswers, buildResult } from '../fixtures/results.ts';

const decision = DecisionSchema.parse(buildDecision());
const settings = { samples: 2, seed: 1, reasoning: false, concurrency: 1 };
const REPLIES = ['A', 'yes', '1'];

function stoppingAfter(calls: number, controller: AbortController) {
  return scriptedTransport(
    (request, index) => {
      if (index + 1 >= calls) controller.abort();
      request.signal?.throwIfAborted();
      return textReply(REPLIES[Math.floor(index / settings.samples)] ?? '');
    },
    { capabilities: [] },
  );
}

function sampler(transport: ReturnType<typeof scriptedTransport>) {
  return new ChatModel({
    id: 'm',
    version: 'm-1',
    capabilities: [],
    transport,
    profile: { temperature: true, seed: true, reasoning: null },
  });
}

describe('Golden', () => {
  it('returns the questions answered before the stop, marked as stopped', async () => {
    const controller = new AbortController();
    const model = sampler(stoppingAfter(settings.samples + 1, controller));

    const result = await model.decide(decision, { ...settings, signal: controller.signal });

    expect({ status: result.status, answered: result.answers.map((answer) => answer.questionId) }).toEqual({
      status: 'stopped',
      answered: [decision.questions[0]?.id],
    });
  });

  it('keeps a stopped run and its finished results instead of rejecting', async () => {
    const controller = new AbortController();
    const model = sampler(stoppingAfter(settings.samples + 1, controller));

    const record = await runDecision({ decision, models: [model], settings, signal: controller.signal });

    expect({ stopped: record.stopped, status: record.results[0]?.status }).toEqual({
      stopped: true,
      status: 'stopped',
    });
  });

  it('accepts a stopped result that answers only some questions', () => {
    const raw = buildResult(decision, { status: 'stopped', answers: buildAnswers(decision).slice(0, 1) });

    expect(parseResult(decision, raw).success).toBe(true);
  });
});

describe('Edge', () => {
  it('keeps the sampled runs that finished before a stop mid-question', async () => {
    const controller = new AbortController();
    const model = sampler(stoppingAfter(settings.samples + 2, controller));

    const result = await model.decide(decision, { ...settings, signal: controller.signal });

    expect(result.answers[1]?.runs).toHaveLength(1);
  });

  it('marks a run that finished normally as not stopped', async () => {
    const model = sampler(
      scriptedTransport((_, index) => textReply(REPLIES[Math.floor(index / settings.samples)] ?? ''), {
        capabilities: [],
      }),
    );

    expect((await runDecision({ decision, models: [model], settings })).stopped).toBe(false);
  });
});

describe('Adversarial', () => {
  it('still validates the answers of a stopped result', () => {
    const [first] = buildAnswers(decision);
    const raw = buildResult(decision, { status: 'stopped', answers: [{ ...first, choice: 'unlisted' }] });

    expect(parseResult(decision, raw).success).toBe(false);
  });
});
