import { describe, expect, it } from 'vitest';
import { ChatModel, DecisionSchema, runBatch } from '../../src/index.ts';
import { logprobsReply, scriptedTransport } from '../fakes/scripted-transport.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';

const settings = { samples: 1, seed: 1, reasoning: false, concurrency: 1 };
const decision = DecisionSchema.parse(buildDecision({ questions: [yesNoQuestion()] }));
const items = ['first', 'second', 'third'].map((text) => ({ input: { kind: 'text' as const, text }, truth: 'yes' }));

function model(transport: ReturnType<typeof scriptedTransport>) {
  return new ChatModel({
    id: 'm',
    version: 'm-1',
    capabilities: ['probabilities'],
    transport,
    profile: { temperature: true, seed: true, reasoning: null },
  });
}

describe('Golden', () => {
  it('keeps each answered item with its probabilities over the options, in item order', async () => {
    const transport = scriptedTransport(() => logprobsReply({ yes: 0.75, no: 0.25 }));

    const outcome = await runBatch({ decision, models: [model(transport)], questionId: 'approve', items, settings });

    expect(outcome.byModel.m?.[1]).toMatchObject({ index: 1, status: 'ok' });
    expect(outcome.byModel.m?.[1]?.probabilities?.[0]).toBeCloseTo(0.75);
    expect(outcome.stopped).toBe(false);
  });
});

describe('Edge', () => {
  it('reports a failed call as a failed item instead of dropping it', async () => {
    const transport = scriptedTransport((_, index) => {
      if (index === 1) throw new Error('upstream 500');
      return logprobsReply({ yes: 0.9, no: 0.1 });
    });

    const outcome = await runBatch({ decision, models: [model(transport)], questionId: 'approve', items, settings });

    expect(outcome.byModel.m?.map((answer) => answer.status)).toEqual(['ok', 'failed', 'ok']);
    expect(outcome.byModel.m?.[1]?.probabilities).toBeNull();
  });

  it('marks the items left after a stop as stopped and the outcome as stopped', async () => {
    const controller = new AbortController();
    const transport = scriptedTransport(() => {
      controller.abort();
      return logprobsReply({ yes: 0.9, no: 0.1 });
    });

    const outcome = await runBatch({
      decision,
      models: [model(transport)],
      questionId: 'approve',
      items,
      settings,
      signal: controller.signal,
    });

    expect(outcome.stopped).toBe(true);
    expect(outcome.byModel.m?.at(-1)?.status).toBe('stopped');
    expect(outcome.byModel.m).toHaveLength(items.length);
  });
});
