import type { Capability } from './capability.ts';

export type TransportMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ReasoningRequest = { effort: string };

export type TransportRequest = {
  model: string;
  messages: TransportMessage[];
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  topLogprobs?: number;
  reasoning?: ReasoningRequest;
  signal?: AbortSignal;
};

export type TokenAlternative = { token: string; logprob: number };

export type TokenLogprob = TokenAlternative & { top: TokenAlternative[] };

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type TransportReply = {
  text: string;
  latencyMs: number;
  costUsd: number | null;
  model?: string;
  reasoning?: string;
  logprobs?: TokenLogprob[];
  usage?: TokenUsage;
};

export interface Transport {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly requiresServer: boolean;
  send(request: TransportRequest): Promise<TransportReply>;
}
