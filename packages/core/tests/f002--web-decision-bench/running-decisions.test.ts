import { describe, expect, it } from 'vitest';
import { ChatModel, DecisionSchema, type Model, plannedCalls, type RunSettings, runDecision } from '../../src/index.ts';
import { fakeModel } from '../fakes/fake-model.ts';
import { scriptedTransport, textReply } from '../fakes/scripted-transport.ts';
import { buildDecision } from '../fixtures/decisions.ts';

const decision = DecisionSchema.parse(buildDecision());
const settings: RunSettings = { samples: 3, seed: 42, reasoning: false, concurrency: 2 };

function failingModel(error: unknown): Model {
  return { ...fakeModel(), id: 'broken', decide: async () => Promise.reject(error) };
}

function samplingModel(id: string) {
  const transport = scriptedTransport(
    (_, index) => textReply(['A', 'yes', '1'][Math.floor(index / settings.samples) % 3] ?? ''),
    {
      capabilities: [],
    },
  );
  return new ChatModel({
    id,
    version: `${id}-1`,
    capabilities: [],
    transport,
    profile: { temperature: true, seed: true, reasoning: null },
  });
}

describe('Golden', () => {
  it('records one parsed result per model, in model order', async () => {
    const record = await runDecision({ decision, models: [fakeModel(), samplingModel('sampler')], settings });

    expect(record.results.map((result) => [result.model.id, result.status])).toEqual([
      ['fake-model', 'ok'],
      ['sampler', 'ok'],
    ]);
  });

  it('pins every model version and its effective capabilities in the lock', async () => {
    const model = fakeModel();

    const record = await runDecision({ decision, models: [model], settings });

    expect(record.lock).toEqual([
      { modelId: model.id, version: model.version, transportId: model.transport.id, capabilities: [] },
    ]);
  });

  it('gives identical configurations the same run id', async () => {
    const first = await runDecision({ decision, models: [fakeModel()], settings });
    const second = await runDecision({ decision, models: [fakeModel()], settings });

    expect(first.runId).toBe(second.runId);
  });

  it('gives a different seed a different run id', async () => {
    const first = await runDecision({ decision, models: [fakeModel()], settings });
    const second = await runDecision({ decision, models: [fakeModel()], settings: { ...settings, seed: 7 } });

    expect(first.runId).not.toBe(second.runId);
  });

  it('plans one call per question for logprobs models and N per question otherwise', () => {
    const logprobs = fakeModel({ capabilities: ['probabilities'], transport: scriptedTransport(() => textReply('')) });

    expect(plannedCalls(decision, [logprobs, samplingModel('s')], settings.samples)).toBe(
      decision.questions.length * (1 + settings.samples),
    );
  });

  it('reports progress up to the planned total', async () => {
    const seen: [number, number][] = [];

    await runDecision({
      decision,
      models: [samplingModel('s')],
      settings,
      onProgress: (done, total) => seen.push([done, total]),
    });

    expect(seen.at(-1)).toEqual([
      decision.questions.length * settings.samples,
      decision.questions.length * settings.samples,
    ]);
  });
});

describe('Edge', () => {
  it('records a throwing model as failed without sinking the others', async () => {
    const record = await runDecision({ decision, models: [failingModel(new Error('boom')), fakeModel()], settings });

    expect(record.results.map((result) => result.status)).toEqual(['failed', 'ok']);
  });

  it('keeps the error message of a failed model', async () => {
    const record = await runDecision({ decision, models: [failingModel(new Error('rate limited'))], settings });

    expect(record.results[0]).toMatchObject({ status: 'failed', error: 'rate limited' });
  });

  it('records a run stopped before it started as stopped, with no answers', async () => {
    const controller = new AbortController();
    controller.abort();

    const record = await runDecision({ decision, models: [samplingModel('s')], settings, signal: controller.signal });

    expect({ stopped: record.stopped, answers: record.results[0]?.answers }).toEqual({ stopped: true, answers: [] });
  });
});

describe('Adversarial', () => {
  it('records a model returning an invalid result as failed', async () => {
    const liar: Model = {
      ...fakeModel(),
      decide: async () => ({ ...(await fakeModel().decide(decision)), answers: [] }),
    };

    const record = await runDecision({ decision, models: [liar], settings });

    expect(record.results[0].status).toBe('failed');
  });

  it('records a model that throws a non-error value as failed', async () => {
    const record = await runDecision({ decision, models: [failingModel('<b>nope</b>')], settings });

    expect(record.results[0]).toMatchObject({ status: 'failed', error: '<b>nope</b>' });
  });
});
