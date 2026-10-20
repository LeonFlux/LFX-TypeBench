import {
  API_HEADER,
  API_HEADER_VALUE,
  HEALTH_PATH,
  maskKey,
  OPEN_ROUTER_CHAT_PATH,
  ServerTransport,
  type Transport,
  type TransportRequest,
} from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';

const request: TransportRequest = {
  model: 'google/gemma-4-26b-a4b-it:free',
  messages: [{ role: 'user', content: 'Pick one' }],
  maxTokens: 16,
};
const reply = { text: 'yes', latencyMs: 12, costUsd: 0, usage: { inputTokens: 40, outputTokens: 1 } };

function recordingTransport(send: Transport['send'] = async () => reply) {
  const seen: TransportRequest[] = [];
  const transport: Transport = {
    id: 'open-router',
    capabilities: ['reasoning'],
    requiresServer: false,
    send: async (incoming) => {
      seen.push(incoming);
      return send(incoming);
    },
  };
  return { transport, seen };
}

function post(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request(OPEN_ROUTER_CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [API_HEADER]: API_HEADER_VALUE, ...headers },
    body: JSON.stringify(body),
  });
}

function viaServer(app: ReturnType<typeof createApp>) {
  return new ServerTransport({
    baseUrl: 'http://127.0.0.1',
    fetcher: async (input, init) => app.request(String(input), init),
  });
}

describe('Golden', () => {
  it('reports OpenRouter as available when the server has a key', async () => {
    const response = await createApp({ openRouter: recordingTransport().transport }).request(HEALTH_PATH);

    expect(await response.json()).toMatchObject({ status: 'ok', features: { openRouter: true } });
  });

  it('forwards a chat request to OpenRouter and returns its reply', async () => {
    const { transport, seen } = recordingTransport();

    const response = await post(createApp({ openRouter: transport }), request);

    expect({ body: await response.json(), model: seen[0]?.model }).toEqual({ body: reply, model: request.model });
  });

  it('serves the browser transport end to end', async () => {
    const { transport } = recordingTransport();

    expect(await viaServer(createApp({ openRouter: transport })).send(request)).toEqual(reply);
  });
});

describe('Edge', () => {
  it('shows only the first and last six characters of the key', async () => {
    const app = createApp({
      openRouter: recordingTransport().transport,
      keyHint: maskKey('sk-or-v1-0123456789abcdef'),
    });

    expect(await (await app.request(HEALTH_PATH)).json()).toMatchObject({ keyHint: 'sk-or-...abcdef' });
  });

  it('gives no key hint without a key', async () => {
    expect(await (await createApp({ openRouter: null }).request(HEALTH_PATH)).json()).toMatchObject({ keyHint: null });
  });

  it('reports OpenRouter as unavailable without a key', async () => {
    const response = await createApp({ openRouter: null }).request(HEALTH_PATH);

    expect(await response.json()).toMatchObject({ features: { openRouter: false } });
  });

  it('explains a missing key instead of calling out', async () => {
    const response = await post(createApp({ openRouter: null }), request);

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 503,
      body: { error: expect.stringContaining('OPENROUTER_KEY') },
    });
  });

  it('passes an OpenRouter failure through as a bad gateway with its message', async () => {
    const { transport } = recordingTransport(async () => {
      throw new Error('OpenRouter 429 rate limited');
    });

    await expect(viaServer(createApp({ openRouter: transport })).send(request)).rejects.toThrow(
      'OpenRouter 429 rate limited',
    );
  });
});

describe('Adversarial', () => {
  it('accepts the forwarded Codespaces origin it was started with', async () => {
    const origin = 'https://my-space-8787.app.github.dev';
    const { transport, seen } = recordingTransport();

    const response = await post(createApp({ openRouter: transport, allowedOrigins: [origin] }), request, { origin });

    expect({ status: response.status, calls: seen.length }).toEqual({ status: 200, calls: 1 });
  });

  it('refuses another Codespaces origin', async () => {
    const { transport, seen } = recordingTransport();
    const app = createApp({ openRouter: transport, allowedOrigins: ['https://my-space-8787.app.github.dev'] });

    const response = await post(app, request, { origin: 'https://other-space-8787.app.github.dev' });

    expect({ status: response.status, calls: seen.length }).toEqual({ status: 403, calls: 0 });
  });

  it('refuses a request without the app header', async () => {
    const { transport, seen } = recordingTransport();

    const response = await createApp({ openRouter: transport }).request(OPEN_ROUTER_CHAT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect({ status: response.status, calls: seen.length }).toEqual({ status: 403, calls: 0 });
  });

  it('refuses a request from another website', async () => {
    const { transport, seen } = recordingTransport();

    const response = await post(createApp({ openRouter: transport }), request, { origin: 'https://evil.example' });

    expect({ status: response.status, calls: seen.length }).toEqual({ status: 403, calls: 0 });
  });

  it.each([
    ['an unknown field', { ...request, apiKey: 'steal' }],
    ['an oversized token budget', { ...request, maxTokens: 1_000_000 }],
    ['a model id with a path traversal', { ...request, model: '../../admin' }],
    ['no messages', { ...request, messages: [] }],
    ['a non-JSON body', 'not json'],
  ])('rejects %s without calling out', async (_, body) => {
    const { transport, seen } = recordingTransport();

    const response = await post(createApp({ openRouter: transport }), body);

    expect({ status: response.status, calls: seen.length }).toEqual({ status: 400, calls: 0 });
  });
});
