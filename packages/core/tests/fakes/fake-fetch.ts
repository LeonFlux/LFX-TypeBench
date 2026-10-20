export type RecordedCall = { url: string; headers: Headers; body: Record<string, unknown> | null };

export function fakeFetch(respond: (url: string) => { status?: number; body: unknown }) {
  const calls: RecordedCall[] = [];
  async function fetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push({ url: request.url, headers: request.headers, body: text ? JSON.parse(text) : null });
    if (request.signal.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const { status = 200, body } = respond(request.url);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  return { fetcher, calls };
}

export function chatCompletion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    created: 1760000000,
    model: 'google/gemma-4-31b-it',
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'A', reasoning: 'Billing cues dominate.' },
        logprobs: {
          content: [
            {
              token: 'A',
              logprob: -0.1,
              bytes: null,
              top_logprobs: [
                { token: 'A', logprob: -0.1, bytes: null },
                { token: 'B', logprob: -2.4, bytes: null },
              ],
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 1, total_tokens: 121, cost: 0.00002 },
    ...overrides,
  };
}
