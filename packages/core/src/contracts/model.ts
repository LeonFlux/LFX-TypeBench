import type { Decision } from '../schemas/decision.ts';
import type { Result } from '../schemas/result.ts';
import type { Capability } from './capability.ts';
import type { Transport } from './transport.ts';

export type DecideOptions = {
  samples?: number;
  seed?: number;
  reasoning?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  onCall?: () => void;
};

export interface Model {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly Capability[];
  readonly transport: Transport;
  decide(decision: Decision, options?: DecideOptions): Promise<Result>;
}
