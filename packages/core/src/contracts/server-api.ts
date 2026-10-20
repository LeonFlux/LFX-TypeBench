import { z } from 'zod';
import { MAX_INPUT_CHARS } from '../limits.ts';

export const API_HEADER = 'x-typed-decisions';
export const API_HEADER_VALUE = '1';
export const HEALTH_PATH = '/api/health';
export const OPEN_ROUTER_CHAT_PATH = '/api/open-router/chat';

const MAX_MESSAGES = 8;
const PROMPT_OVERHEAD_CHARS = 20_000;
const MAX_OUTPUT_TOKENS = 16_384;
const MAX_TOP_LOGPROBS = 20;
const MAX_TEMPERATURE = 2;
const MODEL_ID = /^[a-z0-9][a-z0-9._~:/-]{0,199}$/i;

export const TransportRequestSchema = z.strictObject({
  model: z.string().regex(MODEL_ID),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(MAX_INPUT_CHARS + PROMPT_OVERHEAD_CHARS),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
  temperature: z.number().min(0).max(MAX_TEMPERATURE).optional(),
  seed: z.int().optional(),
  maxTokens: z.int().positive().max(MAX_OUTPUT_TOKENS).optional(),
  topLogprobs: z.int().min(0).max(MAX_TOP_LOGPROBS).optional(),
  reasoning: z.strictObject({ effort: z.string().max(20) }).optional(),
});

const AlternativeSchema = z.object({ token: z.string(), logprob: z.number() });

export const TransportReplySchema = z.object({
  text: z.string(),
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  logprobs: z.array(AlternativeSchema.extend({ top: z.array(AlternativeSchema) })).optional(),
  usage: z.object({ inputTokens: z.int().nonnegative(), outputTokens: z.int().nonnegative() }).optional(),
});

export const ApiErrorSchema = z.object({ error: z.string() });

export const HealthSchema = z.object({
  status: z.literal('ok'),
  keyHint: z.string().nullable(),
  features: z.object({
    openRouter: z.boolean(),
    history: z.boolean(),
    cli: z.boolean(),
    localModels: z.boolean(),
  }),
});

export type Health = z.infer<typeof HealthSchema>;

const HINT_CHARS = 6;
const HIDDEN = '...';

export function maskKey(key: string): string {
  if (key.length < HINT_CHARS * 2 + HIDDEN.length) return HIDDEN;
  return `${key.slice(0, HINT_CHARS)}${HIDDEN}${key.slice(-HINT_CHARS)}`;
}
