import type { Model } from '../contracts/model.ts';
import { type Decision, optionsOf } from '../schemas/decision.ts';
import type { Answer, Result } from '../schemas/result.ts';
import { decideSafely } from './decide-safely.ts';
import { diffHalfWidth } from './metrics.ts';
import { callsPerQuestion, type Progress, progressCounter, type RunSettings } from './runner.ts';
import { type Segment, segmentInput, withoutSegment } from './segments.ts';

export type KnockoutRow = {
  segment: Segment;
  probabilities: number[] | null;
  delta: number[] | null;
  halfWidth: number[] | null;
  error?: string;
};

export type Knockout = {
  questionId: string;
  modelId: string;
  options: string[];
  rows: KnockoutRow[];
  stopped: boolean;
};

type KnockoutRequest = {
  decision: Decision;
  model: Model;
  questionId: string;
  baseline: Answer;
  settings: RunSettings;
  signal?: AbortSignal;
  onProgress?: Progress;
};

const NO_ANSWER = 'No answer';

function errorOf(result: Result) {
  return result.status === 'failed' ? result.error : NO_ANSWER;
}

export function probabilitiesOf(answer: Answer, options: string[]): number[] {
  return options.map((option) => answer.distribution?.find((entry) => entry.option === option)?.probability ?? 0);
}

export function validRuns(answer: Answer): number {
  return answer.runs?.filter((run) => run.answer !== null).length ?? 0;
}

function shiftOf(segment: Segment, answer: Answer, options: string[], baseline: number[]): KnockoutRow {
  const probabilities = probabilitiesOf(answer, options);
  const n = validRuns(answer);
  return {
    segment,
    probabilities,
    delta: probabilities.map((probability, index) => probability - (baseline[index] ?? 0)),
    halfWidth: n
      ? probabilities.map((probability, index) => diffHalfWidth(probability, baseline[index] ?? 0, n))
      : null,
  };
}

export async function runKnockout(request: KnockoutRequest): Promise<Knockout> {
  const { decision, model, questionId, baseline, settings, signal, onProgress } = request;
  const question = decision.questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Unknown question ${questionId}`);

  const options = optionsOf(question);
  const base = probabilitiesOf(baseline, options);
  const segments = segmentInput(decision.input);
  const onCall = progressCounter(segments.length * callsPerQuestion(model, settings.samples), onProgress);
  const decideOptions = { ...settings, reasoning: false, onCall, ...(signal ? { signal } : {}) };

  const rows: KnockoutRow[] = [];
  for (const segment of segments) {
    if (signal?.aborted) break;
    const reduced = { input: withoutSegment(decision.input, segment), questions: [question] };
    const result = await decideSafely(model, reduced, decideOptions);
    const [answer] = result.answers;
    if (result.status === 'stopped') break;
    rows.push(
      result.status === 'ok' && answer
        ? shiftOf(segment, answer, options, base)
        : { segment, probabilities: null, delta: null, halfWidth: null, error: errorOf(result) },
    );
  }
  return { questionId, modelId: model.id, options, rows, stopped: signal?.aborted ?? false };
}
