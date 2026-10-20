import type { OpenRouterCore } from '@openrouter/sdk/core.js';
import { chatSend } from '@openrouter/sdk/funcs/chatSend.js';
import type { ChatRequest, ChatResult, ChatTokenLogprob } from '@openrouter/sdk/models';
import type { Capability } from '../../contracts/capability.ts';
import type { TokenLogprob, Transport, TransportReply, TransportRequest } from '../../contracts/transport.ts';
import { type Fetcher, openRouterClient } from './open-router-client.ts';

export const OPEN_ROUTER_ID = 'open-router';

const CAPABILITIES: Capability[] = ['probabilities', 'reasoning'];
const REDACTED = '[redacted]';
const RETRY_CODES = ['5XX'];
const RETRIES = {
  strategy: 'backoff',
  backoff: { initialInterval: 1000, maxInterval: 4000, exponent: 2, maxElapsedTime: 10_000 },
  retryConnectionErrors: true,
} as const;
const ABORT_ERROR = 'AbortError';

type OpenRouterTransportOptions = { apiKey: string; fetcher?: Fetcher };

const UPSTREAM_RETRIES = 2;
const UPSTREAM_RETRY_DELAY_MS = 1000;
const HTTP_OK = 200;

function isUpstreamError(error: unknown): boolean {
  return (error as { statusCode?: unknown }).statusCode === HTTP_OK;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The run was cancelled', ABORT_ERROR));
      },
      { once: true },
    );
  });
}

function chatRequestOf(request: TransportRequest): ChatRequest {
  const wantsLogprobs = request.topLogprobs !== undefined;
  return {
    model: request.model,
    messages: request.messages,
    stream: false,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.reasoning ? { reasoning: { effort: request.reasoning.effort as never } } : {}),
    ...(wantsLogprobs
      ? { logprobs: true, topLogprobs: request.topLogprobs, provider: { requireParameters: true } }
      : {}),
  };
}

function textOf(content: ChatResult['choices'][number]['message']['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? []).map((item) => ('text' in item ? item.text : '')).join('');
}

function logprobOf(token: ChatTokenLogprob): TokenLogprob {
  return {
    token: token.token,
    logprob: token.logprob,
    top: token.topLogprobs.map(({ token: alternative, logprob }) => ({ token: alternative, logprob })),
  };
}

function apiMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === 'string' ? parsed.error.message : null;
  } catch {
    return null;
  }
}

export class OpenRouterTransport implements Transport {
  readonly id = OPEN_ROUTER_ID;
  readonly capabilities = CAPABILITIES;
  readonly requiresServer = false;
  private readonly client: OpenRouterCore;
  private readonly apiKey: string;

  constructor({ apiKey, fetcher }: OpenRouterTransportOptions) {
    this.apiKey = apiKey;
    this.client = openRouterClient({ apiKey, ...(fetcher ? { fetcher } : {}) });
  }

  async send(request: TransportRequest): Promise<TransportReply> {
    const started = performance.now();
    for (let attempt = 0; ; attempt++) {
      request.signal?.throwIfAborted();
      const outcome = await chatSend(
        this.client,
        { chatRequest: { ...chatRequestOf(request), stream: false } },
        { retries: RETRIES, retryCodes: RETRY_CODES, ...(request.signal ? { signal: request.signal } : {}) },
      );
      if (outcome.ok) return this.replyOf(outcome.value as ChatResult, performance.now() - started);
      if (!isUpstreamError(outcome.error) || attempt >= UPSTREAM_RETRIES)
        throw this.errorOf(outcome.error, request.signal);
      await pause(UPSTREAM_RETRY_DELAY_MS * (attempt + 1), request.signal);
    }
  }

  private replyOf(result: ChatResult, latencyMs: number): TransportReply {
    const [choice] = result.choices;
    if (!choice) throw new Error('OpenRouter returned no choices');

    const tokens = choice.logprobs?.content;
    const reasoning = choice.message.reasoning;
    return {
      text: textOf(choice.message.content),
      latencyMs,
      costUsd: result.usage?.cost ?? null,
      model: result.model,
      ...(reasoning ? { reasoning } : {}),
      ...(tokens ? { logprobs: tokens.map(logprobOf) } : {}),
      ...(result.usage
        ? { usage: { inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens } }
        : {}),
    };
  }

  private errorOf(error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted) return new DOMException('The run was cancelled', ABORT_ERROR);
    const status = (error as { statusCode?: unknown }).statusCode;
    const body = (error as { body?: unknown }).body;
    const detail = typeof body === 'string' ? apiMessage(body) : null;
    const message = [
      'OpenRouter',
      typeof status === 'number' ? status : null,
      detail ?? (error instanceof Error ? error.message : String(error)),
    ]
      .filter((part) => part !== null)
      .join(' ');
    return new Error(message.replaceAll(this.apiKey, REDACTED));
  }
}
