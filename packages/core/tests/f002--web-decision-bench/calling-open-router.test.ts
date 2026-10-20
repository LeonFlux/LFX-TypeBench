import { describe, expect, it } from 'vitest';
import { type CatalogEntry, loadCatalog, OpenRouterTransport, type TransportRequest } from '../../src/index.ts';
import { chatCompletion, fakeFetch } from '../fakes/fake-fetch.ts';
import listings from '../fixtures/open-router-models.json' with { type: 'json' };

const API_KEY = 'sk-or-test-key';
const OPEN_ROUTER_ORIGIN = 'https://openrouter.ai';
const request: TransportRequest = {
  model: 'google/gemma-4-31b-it',
  messages: [{ role: 'user', content: 'Pick one' }],
  temperature: 0,
  seed: 3,
  maxTokens: 4,
  topLogprobs: 20,
  reasoning: { effort: 'none' },
};

async function catalogEntry(id: string): Promise<CatalogEntry | undefined> {
  const { fetcher } = fakeFetch(() => ({ body: listings }));
  return (await loadCatalog({ fetcher })).find((entry) => entry.id === id);
}

function transport(respond: Parameters<typeof fakeFetch>[0] = () => ({ body: chatCompletion() })) {
  const fake = fakeFetch(respond);
  return { ...fake, transport: new OpenRouterTransport({ apiKey: API_KEY, fetcher: fake.fetcher }) };
}

describe('Golden', () => {
  it('sends the chat request to OpenRouter with the key as a bearer token', async () => {
    const { calls, transport: openRouter } = transport();

    await openRouter.send(request);

    expect({ origin: new URL(calls[0]?.url ?? '').origin, auth: calls[0]?.headers.get('authorization') }).toEqual({
      origin: OPEN_ROUTER_ORIGIN,
      auth: `Bearer ${API_KEY}`,
    });
  });

  it('asks for top logprobs only from providers that support them', async () => {
    const { calls, transport: openRouter } = transport();

    await openRouter.send(request);

    expect(calls[0]?.body).toMatchObject({
      logprobs: true,
      top_logprobs: 20,
      temperature: 0,
      seed: 3,
      max_tokens: 4,
      reasoning: { effort: 'none' },
      provider: { require_parameters: true },
      stream: false,
    });
  });

  it('maps text, reasoning, logprobs, usage, cost, and the served model', async () => {
    const reply = await transport().transport.send(request);

    expect(reply).toMatchObject({
      text: 'A',
      reasoning: 'Billing cues dominate.',
      logprobs: [
        {
          token: 'A',
          top: [
            { token: 'A', logprob: -0.1 },
            { token: 'B', logprob: -2.4 },
          ],
        },
      ],
      usage: { inputTokens: 120, outputTokens: 1 },
      costUsd: 0.00002,
      model: 'google/gemma-4-31b-it',
    });
  });

  it('derives logprobs and optional reasoning for a model that lists them', async () => {
    expect(await catalogEntry('google/gemma-4-31b-it')).toMatchObject({
      id: 'google/gemma-4-31b-it',
      version: 'google/gemma-4-31b-it-20260402',
      capabilities: ['probabilities', 'reasoning'],
      profile: { temperature: true, seed: true, reasoning: { mandatory: false } },
      contextLength: expect.any(Number),
    });
  });

  it('derives sampling with mandatory low-effort reasoning and no temperature for Claude', async () => {
    expect(await catalogEntry('anthropic/claude-sonnet-5.5')).toMatchObject({
      capabilities: ['reasoning'],
      profile: { temperature: false, seed: false, reasoning: { mandatory: true, effort: 'low' } },
    });
  });

  it('reads per-token pricing from the listing', async () => {
    expect((await catalogEntry('google/gemma-4-31b-it'))?.pricing).toEqual({
      inputPerToken: 0.0000002,
      outputPerToken: 0.0000004,
    });
  });

  it('loads the catalog from the public models endpoint', async () => {
    const { fetcher } = fakeFetch(() => ({ body: listings }));

    const catalog = await loadCatalog({ fetcher });

    expect(catalog.map((entry) => entry.id)).toEqual(listings.data.map((listing) => listing.id));
  });
});

describe('Edge', () => {
  it('leaves out logprobs parameters for a sampling request', async () => {
    const { calls, transport: openRouter } = transport();
    const { topLogprobs: _, ...sampling } = request;

    await openRouter.send(sampling);

    expect(calls[0]?.body).not.toHaveProperty('logprobs');
  });

  it('marks variable pricing as unknown', async () => {
    expect((await catalogEntry('typesafe/jev-router'))?.pricing).toBeNull();
  });

  it('turns an API error into an error carrying the status and message', async () => {
    const { transport: openRouter } = transport(() => ({
      status: 401,
      body: { error: { code: 401, message: 'No auth credentials found' } },
    }));

    await expect(openRouter.send(request)).rejects.toThrow(/401.*No auth credentials found/);
  });

  it('retries an upstream error delivered with status 200', async () => {
    let calls = 0;
    const { transport: openRouter } = transport(() => {
      calls++;
      return calls === 1
        ? { body: { error: { code: 502, message: 'Upstream error from Nvidia: Service temporarily overloaded' } } }
        : { body: chatCompletion() };
    });

    expect((await openRouter.send(request)).text).toBe('A');
  });

  it('does not retry a rate limit', async () => {
    let calls = 0;
    const { transport: openRouter } = transport(() => {
      calls++;
      return { status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } } };
    });

    await expect(openRouter.send(request)).rejects.toThrow(/429/);
    expect(calls).toBe(1);
  });

  it('turns a reply without choices into an error', async () => {
    const { transport: openRouter } = transport(() => ({ body: chatCompletion({ choices: [] }) }));

    await expect(openRouter.send(request)).rejects.toThrow(/no choices/i);
  });

  it('rejects with an abort error when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(transport().transport.send({ ...request, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('Adversarial', () => {
  it('never puts the key in the request body', async () => {
    const { calls, transport: openRouter } = transport();

    await openRouter.send(request);

    expect(JSON.stringify(calls[0]?.body)).not.toContain(API_KEY);
  });

  it('keeps the key out of error messages', async () => {
    const { transport: openRouter } = transport(() => ({
      status: 400,
      body: { error: { code: 400, message: `bad key ${API_KEY}` } },
    }));

    await expect(openRouter.send(request)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(API_KEY) }),
    );
  });
});
