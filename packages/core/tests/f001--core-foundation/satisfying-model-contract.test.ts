import { describe, expect, it } from 'vitest';
import { DecisionSchema, type Model, type Result } from '../../src/index.ts';
import { checkModelContract, describeModelContract } from '../../src/testing/model-contract.ts';
import { fakeModel } from '../fakes/fake-model.ts';
import { fakeTransport } from '../fakes/fake-transport.ts';
import { buildDecision } from '../fixtures/decisions.ts';

const decision = DecisionSchema.parse(buildDecision());

function tampered(model: Model, change: (result: Record<string, unknown>) => Record<string, unknown>): Model {
  return { ...model, decide: async (input) => change(await model.decide(input)) as Result };
}

describe('Golden', () => {
  it('finds no violations for a model whose results parse against the decision', async () => {
    expect(await checkModelContract(fakeModel(), decision)).toEqual([]);
  });

  describeModelContract('a fake model over a browser transport', () => fakeModel());

  describeModelContract('a fake model over a server-only transport', () =>
    fakeModel({ transport: fakeTransport({ requiresServer: true }) }),
  );
});

describe('Edge', () => {
  it('reports a model whose result names another model', async () => {
    const model = tampered(fakeModel(), (result) => ({ ...result, model: { id: 'other', version: '2026-10-01' } }));

    expect(await checkModelContract(model, decision)).not.toEqual([]);
  });

  it('reports a model whose result names another transport', async () => {
    const model = tampered(fakeModel(), (result) => ({ ...result, transport: { id: 'other' } }));

    expect(await checkModelContract(model, decision)).not.toEqual([]);
  });

  it('reports a model whose decide call throws', async () => {
    const model: Model = {
      ...fakeModel(),
      decide: async () => {
        throw new Error('host unreachable');
      },
    };

    expect(await checkModelContract(model, decision)).not.toEqual([]);
  });
});

describe('Adversarial', () => {
  it('reports a model whose result does not parse against the decision', async () => {
    const model = tampered(fakeModel(), (result) => ({ ...result, answers: [] }));

    expect(await checkModelContract(model, decision)).not.toEqual([]);
  });
});
