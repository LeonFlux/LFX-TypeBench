import { CAPABILITIES, DecisionSchema, parseResult, type Result } from '@typed-decisions/core';
import { z } from 'zod';
import type { BenchRun } from '../state.ts';

export type StoredRun = BenchRun & { draftKey: string; historyId: string };

export const HISTORY_STORAGE = 'decisionBench.history';

const QUOTA_ERRORS = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];

const StoredRunSchema = z.object({
  runId: z.string().min(1),
  historyId: z.string().min(1),
  draftKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  decision: DecisionSchema,
  settings: z.object({
    samples: z.int().positive(),
    seed: z.int(),
    reasoning: z.boolean(),
    concurrency: z.int().positive(),
  }),
  lock: z.array(
    z.object({
      modelId: z.string(),
      version: z.string(),
      transportId: z.string(),
      capabilities: z.array(z.enum(CAPABILITIES)),
    }),
  ),
  results: z.array(z.unknown()),
  stopped: z.boolean(),
  meta: z.object({ name: z.string(), id: z.string(), version: z.number() }),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      source: z.enum(['logprobs', 'sampled']),
      reasons: z.boolean(),
      attribution: z.boolean().default(false),
    }),
  ),
});

export function newestFirst(a: StoredRun, b: StoredRun) {
  return b.createdAt.localeCompare(a.createdAt);
}

export function addRun(history: StoredRun[], run: StoredRun): StoredRun[] {
  return [run, ...history.filter((candidate) => candidate.historyId !== run.historyId)].sort(newestFirst);
}

export function runsOf(history: StoredRun[], draftKey: string): StoredRun[] {
  return history.filter((run) => run.draftKey === draftKey).sort(newestFirst);
}

export function deleteRun(history: StoredRun[], historyId: string): StoredRun[] {
  return history.filter((run) => run.historyId !== historyId);
}

export function deleteRunsOf(history: StoredRun[], draftKey: string): StoredRun[] {
  return history.filter((run) => run.draftKey !== draftKey);
}

export function deleteAll(): StoredRun[] {
  return [];
}

function validRun(raw: unknown): StoredRun | null {
  const parsed = StoredRunSchema.safeParse(raw);
  if (!parsed.success) return null;
  const results = parsed.data.results.map((result) => parseResult(parsed.data.decision, result));
  if (!results.every((result) => result.success)) return null;
  return { ...parsed.data, results: results.map((result) => result.data as Result) } as StoredRun;
}

export function validRuns(raw: unknown[]): StoredRun[] {
  return raw
    .map(validRun)
    .filter((run): run is StoredRun => run !== null)
    .sort(newestFirst);
}

export function loadHistory(storage: Storage | null): StoredRun[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(HISTORY_STORAGE) ?? '[]');
    return Array.isArray(raw) ? validRuns(raw) : [];
  } catch {
    return [];
  }
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && QUOTA_ERRORS.includes(error.name);
}
