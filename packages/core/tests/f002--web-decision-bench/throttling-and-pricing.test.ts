import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatModel, DecisionSchema, ThrottledTransport } from '../../src/index.ts';
import { scriptedTransport, textReply } from '../fakes/scripted-transport.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';

const yesNoDecision = DecisionSchema.parse(buildDecision({ questions: [yesNoQuestion()] }));
const REQUESTS_PER_MINUTE = 60;
const SPACING_MS = 60_000 / REQUESTS_PER_MINUTE;
const pricing = { inputPerToken: 0.000001, outputPerToken: 0.000002 };
const usage = { inputTokens: 100, outputTokens: 2 };

function sampler(costUsd: number | null) {
  const transport = scriptedTransport(() => textReply('yes', { costUsd, usage }), { capabilities: [] });
  return new ChatModel({ id: 'm', version: 'm-1', capabilities: [], transport, pricing });
}

describe('Golden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spaces call starts to stay under the requests-per-minute limit', async () => {
    const started: number[] = [];
    const inner = scriptedTransport(() => {
      started.push(Date.now());
      return textReply('yes');
    });
    const throttled = new ThrottledTransport(inner, REQUESTS_PER_MINUTE);

    const calls = Promise.all([0, 1, 2].map(() => throttled.send({ model: 'm', messages: [] })));
    await vi.advanceTimersByTimeAsync(SPACING_MS * 3);
    await calls;

    expect(started.map((time) => time - (started[0] ?? 0))).toEqual([0, SPACING_MS, SPACING_MS * 2]);
  });

  it('keeps the identity and capabilities of the transport it wraps', () => {
    const inner = scriptedTransport(() => textReply('yes'), { capabilities: ['reasoning'], requiresServer: true });

    const throttled = new ThrottledTransport(inner, REQUESTS_PER_MINUTE);

    expect([throttled.id, throttled.capabilities, throttled.requiresServer]).toEqual(['scripted', ['reasoning'], true]);
  });
});

describe('Edge', () => {
  it('does not wait at all without a limit', async () => {
    const throttled = new ThrottledTransport(
      scriptedTransport(() => textReply('yes')),
      0,
    );

    await expect(throttled.send({ model: 'm', messages: [] })).resolves.toMatchObject({ text: 'yes' });
  });

  it('computes cost from tokens and listed prices when the host reports none', async () => {
    const result = await sampler(null).decide(yesNoDecision, { samples: 1 });

    expect(result.answers[0]?.usage?.costUsd).toBeCloseTo(100 * 0.000001 + 2 * 0.000002);
  });

  it('prefers the cost the host reports', async () => {
    const result = await sampler(0.5).decide(yesNoDecision, { samples: 1 });

    expect(result.answers[0]?.usage?.costUsd).toBe(0.5);
  });
});

describe('Adversarial', () => {
  it('rejects a waiting call as soon as the run is cancelled', async () => {
    const throttled = new ThrottledTransport(
      scriptedTransport(() => textReply('yes')),
      1,
    );
    const controller = new AbortController();
    await throttled.send({ model: 'm', messages: [] });

    const waiting = throttled.send({ model: 'm', messages: [], signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
