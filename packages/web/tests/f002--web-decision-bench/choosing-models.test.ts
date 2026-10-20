import { type CatalogEntry, DecisionSchema, maskKey, optionsOf } from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import {
  batchItems,
  defaultDrafts,
  GOLD_SIZE,
  goldSets,
  labeledQuestionIds,
  sampleDraft,
} from '../../src/data/sample.ts';
import { costLabel, estimateRun } from '../../src/services/costs.ts';
import { checkDraft } from '../../src/services/draft.ts';
import {
  addModel,
  entryFromCatalog,
  probabilitySource,
  removeModel,
  resolveModels,
} from '../../src/services/registry.ts';

const settings = { samples: 10, seed: 1, reasoning: false, concurrency: 2 };
const decision = checkDraft(sampleDraft).decision ?? DecisionSchema.parse({});

function listing(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'qwen/qwen3.8-flash',
    name: 'Qwen 3.8 Flash',
    version: 'qwen/qwen3.8-flash-20260826',
    capabilities: ['probabilities'],
    profile: { temperature: true, seed: true, reasoning: null },
    pricing: { inputPerToken: 0.00000015, outputPerToken: 0.00000047 },
    contextLength: 262_144,
    ...overrides,
  };
}

const logprobsModel = entryFromCatalog(listing());
const samplingModel = entryFromCatalog(
  listing({
    id: 'anthropic/claude-sonnet-5.5',
    capabilities: ['reasoning'],
    profile: { temperature: false, seed: false, reasoning: { mandatory: true, effort: 'low' } },
  }),
);
const freeModel = entryFromCatalog(
  listing({ id: 'google/gemma-4-26b-a4b-it:free', capabilities: [], pricing: { inputPerToken: 0, outputPerToken: 0 } }),
);

describe('Golden', () => {
  it('reads logprobs from a model that lists them and samples the others', () => {
    expect([logprobsModel, samplingModel].map(probabilitySource)).toEqual(['logprobs', 'sampled']);
  });

  it('builds every model detail from its catalog listing', () => {
    expect(entryFromCatalog(listing())).toEqual({
      id: 'qwen/qwen3.8-flash',
      label: 'Qwen 3.8 Flash',
      version: 'qwen/qwen3.8-flash-20260826',
      capabilities: ['probabilities'],
      profile: { temperature: true, seed: true, reasoning: null },
      pricing: { inputPerToken: 0.00000015, outputPerToken: 0.00000047 },
      contextLength: 262_144,
    });
  });

  it('adds a model by its catalog id', () => {
    expect(addModel([], 'qwen/qwen3.8-flash', [listing()])).toEqual({ ids: ['qwen/qwen3.8-flash'] });
  });

  it('resolves saved model ids against the live catalog, in list order', () => {
    const catalog = [listing(), listing({ id: 'b/model', name: 'B' })];

    expect(resolveModels(['b/model', 'qwen/qwen3.8-flash'], catalog).map((entry) => entry.label)).toEqual([
      'B',
      'Qwen 3.8 Flash',
    ]);
  });

  it('removes a model from the list', () => {
    expect(removeModel(['a/one', 'b/two'], 'a/one')).toEqual(['b/two']);
  });

  it('estimates more cost for a sampled model than for a logprobs model at the same price', () => {
    const priced = { inputPerToken: 0.000001, outputPerToken: 0.000001 };
    const logprobs = estimateRun(decision, [{ ...logprobsModel, pricing: priced }], settings).usd;
    const sampled = estimateRun(decision, [{ ...samplingModel, pricing: priced }], settings).usd;

    expect(sampled).toBeGreaterThan(logprobs * settings.samples * 0.9);
  });

  it('labels every known-answer item of each default decision for all its questions, within their options', () => {
    const sets = goldSets();

    for (const draft of defaultDrafts()) {
      const parsed = checkDraft(draft).decision;
      const gold = sets[draft.id] ?? [];
      expect(gold).toHaveLength(GOLD_SIZE);
      expect(labeledQuestionIds(gold)).toEqual(parsed?.questions.map((question) => question.id));
      const outside = (parsed?.questions ?? []).flatMap((question) =>
        batchItems(gold, question.id, gold.length).filter((item) => !optionsOf(question).includes(item.truth)),
      );
      expect(outside).toEqual([]);
    }
  });

  it('feeds each decision its own kind of input', () => {
    const sets = goldSets();

    expect(batchItems(sets['loan-review'] ?? [], 'risk', 1)[0]?.input.kind).toBe('json');
    expect(batchItems(sets['review-moderation'] ?? [], 'sentiment', 1)[0]?.input.kind).toBe('text');
  });
});

describe('Edge', () => {
  it('starts with no models', () => {
    expect(resolveModels([], [listing()])).toEqual([]);
  });

  it('shows no models until the catalog has loaded', () => {
    expect(resolveModels(['qwen/qwen3.8-flash'], null)).toEqual([]);
  });

  it('leaves out saved ids the catalog no longer lists', () => {
    expect(resolveModels(['gone/model', 'qwen/qwen3.8-flash'], [listing()]).map((entry) => entry.id)).toEqual([
      'qwen/qwen3.8-flash',
    ]);
  });

  it('refuses a model that is already listed', () => {
    expect(addModel(['qwen/qwen3.8-flash'], 'qwen/qwen3.8-flash', [listing()])).toEqual({ error: 'duplicate' });
  });

  it('refuses a model before the catalog is loaded', () => {
    expect(addModel([], 'qwen/qwen3.8-flash', null)).toEqual({ error: 'offline' });
  });

  it('flags variable pricing in the estimate', () => {
    expect(costLabel(estimateRun(decision, [{ ...logprobsModel, pricing: null }], settings))).toBe('$0 + variable');
  });

  it('estimates free models at $0', () => {
    expect(costLabel(estimateRun(decision, [freeModel], settings))).toBe('$0');
  });

  it('samples a model whose reasoning cannot be turned off, even with logprobs', () => {
    const entry = {
      ...logprobsModel,
      profile: { ...logprobsModel.profile, reasoning: { mandatory: true, effort: 'low' } },
    };

    expect(probabilitySource(entry)).toBe('sampled');
  });
});

describe('Adversarial', () => {
  it('refuses an id the catalog does not list', () => {
    expect(addModel([], 'evil/<script>', [listing()])).toEqual({ error: 'unknown' });
  });

  it('never shows a short key in its hint', () => {
    expect(maskKey('sk-short')).toBe('...');
  });
});
