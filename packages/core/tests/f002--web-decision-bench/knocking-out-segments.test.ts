import { describe, expect, it } from 'vitest';
import { ChatModel, DecisionSchema, runKnockout, segmentInput, withoutSegment } from '../../src/index.ts';
import { logprobsReply, scriptedTransport, textReply } from '../fakes/scripted-transport.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';

const TEXT = 'Hi — I was charged twice. I cannot log in. Please fix this today!';
const decision = DecisionSchema.parse(
  buildDecision({ input: { kind: 'text', text: TEXT }, questions: [yesNoQuestion()] }),
);
const settings = { samples: 4, seed: 1, reasoning: false, concurrency: 2 };

function urgencyTransport() {
  return scriptedTransport((request) => {
    const urgent = request.messages.at(-1)?.content.includes('today');
    return logprobsReply(urgent ? { yes: 0.9, no: 0.1 } : { yes: 0.3, no: 0.7 });
  });
}

function model(transport = urgencyTransport()) {
  return new ChatModel({
    id: 'm',
    version: 'm-1',
    capabilities: ['probabilities'],
    transport,
    profile: { temperature: true, seed: true, reasoning: null },
  });
}

describe('Golden', () => {
  it('splits text into a leading greeting and sentences', () => {
    expect(segmentInput(decision.input).map((segment) => segment.text)).toEqual([
      'Hi —',
      'I was charged twice.',
      'I cannot log in.',
      'Please fix this today!',
    ]);
  });

  it('keeps a non-text JSON value whole, as one segment per key', () => {
    const input = { kind: 'json' as const, json: { amount: 1200, plan: { tier: 'Business' } } };

    expect(segmentInput(input).map((segment) => segment.id)).toEqual(['key:amount', 'key:plan']);
  });

  it('removes a JSON key cleanly', () => {
    const input = { kind: 'json' as const, json: { body: 'hello', plan: 'Business' } };

    expect(withoutSegment(input, segmentInput(input)[1])).toEqual({ kind: 'json', json: { body: 'hello' } });
  });

  it('measures how far each removed segment moves the probabilities', async () => {
    const baseline = (await model().decide(decision)).answers[0];

    const knockout = await runKnockout({ decision, model: model(), questionId: 'approve', baseline, settings });

    const lastRow = knockout.rows.at(-1);
    expect(lastRow?.delta?.[0]).toBeCloseTo(0.3 - 0.9);
  });

  it('runs one call per segment for a logprobs model', async () => {
    const transport = urgencyTransport();
    const baseline = (await model().decide(decision)).answers[0];

    await runKnockout({ decision, model: model(transport), questionId: 'approve', baseline, settings });

    expect(transport.requests).toHaveLength(segmentInput(decision.input).length);
  });
});

describe('Edge', () => {
  it('segments a JSON string value exactly like the same text', () => {
    const json = { kind: 'json' as const, json: { body: TEXT } };

    expect(segmentInput(json)).toEqual(segmentInput(decision.input));
  });

  it('removes a sentence from inside a JSON string value', () => {
    const json = { kind: 'json' as const, json: { body: TEXT, plan: 'Business' } };
    const last = segmentInput(json).find((segment) => segment.text === 'Please fix this today!');

    expect(last && withoutSegment(json, last)).toEqual({
      kind: 'json',
      json: { body: 'Hi — I was charged twice. I cannot log in.', plan: 'Business' },
    });
  });

  it('attaches a noise band to sampled knockouts', async () => {
    const transport = scriptedTransport(() => textReply('yes'), { capabilities: [] });
    const sampler = new ChatModel({
      id: 's',
      version: 's-1',
      capabilities: [],
      transport,
      profile: { temperature: true, seed: true, reasoning: null },
    });
    const baseline = (await sampler.decide(decision, settings)).answers[0];

    const knockout = await runKnockout({ decision, model: sampler, questionId: 'approve', baseline, settings });

    expect(knockout.rows[0].halfWidth?.[0]).toBeGreaterThan(0);
  });

  it('records a failed segment with its error instead of a shift', async () => {
    const baseline = (await model().decide(decision)).answers[0];
    const broken = model(scriptedTransport(() => logprobsReply({ ' I': 1 })));

    const knockout = await runKnockout({ decision, model: broken, questionId: 'approve', baseline, settings });

    expect(knockout.rows[0]).toMatchObject({ delta: null, error: expect.any(String) });
  });

  it('has no segments for a JSON value that is not an object', () => {
    expect(segmentInput({ kind: 'json', json: [1, 2, 3] })).toEqual([]);
  });
});

describe('Adversarial', () => {
  it('removes only the segment, even when its text repeats elsewhere', () => {
    const input = { kind: 'text' as const, text: 'Fix it. Fix it. Thanks.' };
    const [, second] = segmentInput(input);

    expect(withoutSegment(input, second)).toEqual({ kind: 'text', text: 'Fix it. Thanks.' });
  });
});
