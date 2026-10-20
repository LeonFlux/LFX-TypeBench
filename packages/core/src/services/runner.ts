import type { Capability } from '../contracts/capability.ts';
import type { Model } from '../contracts/model.ts';
import type { Decision } from '../schemas/decision.ts';
import type { Result } from '../schemas/result.ts';
import { effectiveCapabilities } from './capabilities.ts';
import { decideSafely } from './decide-safely.ts';
import { digest, stableStringify } from './fingerprint.ts';

export type RunSettings = { samples: number; seed: number; reasoning: boolean; concurrency: number };

export type LockEntry = { modelId: string; version: string; transportId: string; capabilities: Capability[] };

export type RunRecord = {
  runId: string;
  createdAt: string;
  decision: Decision;
  settings: RunSettings;
  lock: LockEntry[];
  results: Result[];
  stopped: boolean;
};

export type Progress = (done: number, total: number) => void;

type RunRequest = {
  decision: Decision;
  models: Model[];
  settings: RunSettings;
  signal?: AbortSignal;
  onProgress?: Progress;
};

const RUN_ID_PREFIX = 'r-';

export function callsPerQuestion(model: Model, samples: number): number {
  return effectiveCapabilities(model).includes('probabilities') ? 1 : samples;
}

export function plannedCalls(decision: Decision, models: Model[], samples: number): number {
  return models.reduce((sum, model) => sum + decision.questions.length * callsPerQuestion(model, samples), 0);
}

export function progressCounter(total: number, onProgress?: Progress) {
  let done = 0;
  return () => onProgress?.(++done, total);
}

function lockOf(model: Model): LockEntry {
  return {
    modelId: model.id,
    version: model.version,
    transportId: model.transport.id,
    capabilities: effectiveCapabilities(model),
  };
}

export async function runDecision({ decision, models, settings, signal, onProgress }: RunRequest): Promise<RunRecord> {
  const onCall = progressCounter(plannedCalls(decision, models, settings.samples), onProgress);
  const options = { ...settings, onCall, ...(signal ? { signal } : {}) };
  const results = await Promise.all(models.map((model) => decideSafely(model, decision, options)));
  const lock = models.map(lockOf);

  return {
    runId: RUN_ID_PREFIX + digest(stableStringify({ decision, settings, lock })),
    createdAt: new Date().toISOString(),
    decision,
    settings: { ...settings },
    lock,
    results,
    stopped: signal?.aborted ?? false,
  };
}
