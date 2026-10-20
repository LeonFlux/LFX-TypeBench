import { describe, expect, it } from 'vitest';
import { type BatchAnswer, binOf, itemsMatching } from '../../src/index.ts';

const OPTIONS = ['yes', 'no'];
const ok = (index: number, yes: number): BatchAnswer => ({ index, status: 'ok', probabilities: [yes, 1 - yes] });
const failed = (index: number): BatchAnswer => ({ index, status: 'failed', probabilities: null });

const truths = ['yes', 'yes', 'no', 'no', 'yes'];
const byModel = {
  a: [ok(0, 0.95), ok(1, 0.1), ok(2, 0.85), ok(3, 0.4), failed(4)],
  b: [ok(0, 0.9), ok(1, 0.8), ok(2, 0.3), ok(3, 0.2), ok(4, 0.6)],
};
const match = (
  filter: Parameters<typeof itemsMatching>[0]['filter'],
  drill: Parameters<typeof itemsMatching>[0]['drill'] = null,
) => itemsMatching({ options: OPTIONS, truths, byModel, modelId: 'a', filter, drill });

describe('Golden', () => {
  it.each([
    ['all', [0, 1, 2, 3, 4]],
    ['wrong', [1, 2]],
    ['confidently-wrong', [1, 2]],
    ['disagree', [1, 2]],
    ['all-wrong', []],
    ['failed', [4]],
  ] as const)('filters items by %s', (filter, expected) => {
    expect(match(filter)).toEqual(expected);
  });

  it('drills into the items of one confidence bin of the selected model', () => {
    expect(match('all', { bin: 9 })).toEqual([0, 1]);
  });

  it('drills into the items of one confusion-matrix cell of the selected model', () => {
    expect(match('all', { truth: 'no', predicted: 'yes' })).toEqual([2]);
  });

  it('puts a confidence into the same bin the calibration curve uses', () => {
    expect([binOf(0), binOf(0.849), binOf(0.85), binOf(1)]).toEqual([0, 8, 8, 9]);
  });
});

describe('Edge', () => {
  it('counts a confidence just below 80% as not confidently wrong', () => {
    const result = itemsMatching({
      options: OPTIONS,
      truths: ['no'],
      byModel: { a: [ok(0, 0.79)] },
      modelId: 'a',
      filter: 'confidently-wrong',
      drill: null,
    });

    expect(result).toEqual([]);
  });

  it('finds items every answering model got wrong', () => {
    const result = itemsMatching({
      options: OPTIONS,
      truths: ['no', 'no'],
      byModel: { a: [ok(0, 0.9), ok(1, 0.1)], b: [ok(0, 0.7), failed(1)] },
      modelId: 'a',
      filter: 'all-wrong',
      drill: null,
    });

    expect(result).toEqual([0]);
  });

  it('combines a filter with a drill', () => {
    expect(match('wrong', { bin: 9 })).toEqual([1]);
  });

  it('finds nothing for a model the run does not have', () => {
    const result = itemsMatching({ options: OPTIONS, truths, byModel, modelId: 'gone', filter: 'wrong', drill: null });

    expect(result).toEqual([]);
  });
});
