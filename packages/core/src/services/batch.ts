import type { Model } from '../contracts/model.ts';
import { type Decision, optionsOf } from '../schemas/decision.ts';
import { decideSafely } from './decide-safely.ts';
import { probabilitiesOf } from './knockout.ts';
import { pool } from './pool.ts';
import { callsPerQuestion, type Progress, progressCounter, type RunSettings } from './runner.ts';

export type BatchItem = { input: Decision['input']; truth: string };

export type BatchAnswer = { index: number; status: 'ok' | 'failed' | 'stopped'; probabilities: number[] | null };

export type BatchOutcome = { byModel: Record<string, BatchAnswer[]>; stopped: boolean };

type BatchRequest = {
  decision: Decision;
  models: Model[];
  questionId: string;
  items: BatchItem[];
  settings: RunSettings;
  signal?: AbortSignal;
  onProgress?: Progress;
};

export async function runBatch(request: BatchRequest): Promise<BatchOutcome> {
  const { decision, models, questionId, items, settings, signal, onProgress } = request;
  const question = decision.questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Unknown question ${questionId}`);

  const asked = question;
  const options = optionsOf(asked);
  const total = items.length * models.reduce((sum, model) => sum + callsPerQuestion(model, settings.samples), 0);
  const onCall = progressCounter(total, onProgress);
  const decideOptions = { ...settings, reasoning: false, concurrency: 1, onCall, ...(signal ? { signal } : {}) };

  async function answer(model: Model, item: BatchItem, index: number): Promise<BatchAnswer> {
    const result = await decideSafely(model, { input: item.input, questions: [asked] }, decideOptions);
    const [first] = result.answers;
    if (result.status === 'ok' && first) return { index, status: 'ok', probabilities: probabilitiesOf(first, options) };
    return { index, status: result.status === 'stopped' ? 'stopped' : 'failed', probabilities: null };
  }

  const answersByModel = await Promise.all(
    models.map(async (model) => {
      const answers = await pool(
        items.map((item, index) => () => answer(model, item, index)),
        settings.concurrency,
      );
      return [model.id, answers] as const;
    }),
  );
  return { byModel: Object.fromEntries(answersByModel), stopped: signal?.aborted ?? false };
}
