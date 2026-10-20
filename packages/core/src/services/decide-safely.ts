import type { DecideOptions, Model } from '../contracts/model.ts';
import type { Decision } from '../schemas/decision.ts';
import { parseResult, type Result } from '../schemas/result.ts';
import { isAbort, messageOf } from './errors.ts';

const INVALID_RESULT = 'Invalid result';

export function failedResult(model: Model, error: string): Result {
  return {
    status: 'failed',
    model: { id: model.id, version: model.version },
    transport: { id: model.transport.id },
    error,
    answers: [],
    latencyMs: 0,
    costUsd: null,
  };
}

export function stoppedResult(model: Model): Result {
  return {
    status: 'stopped',
    model: { id: model.id, version: model.version },
    transport: { id: model.transport.id },
    answers: [],
    latencyMs: 0,
    costUsd: null,
  };
}

export async function decideSafely(model: Model, decision: Decision, options: DecideOptions): Promise<Result> {
  let raw: unknown;
  try {
    raw = await model.decide(decision, options);
  } catch (error) {
    return isAbort(error) ? stoppedResult(model) : failedResult(model, messageOf(error));
  }

  const parsed = parseResult(decision, raw);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return failedResult(model, `${INVALID_RESULT}: ${issue?.path.join('.')} ${issue?.message}`);
}
