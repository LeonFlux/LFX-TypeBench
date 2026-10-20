import { describe, expect, it } from 'vitest';
import { agreement, type BatchAnswer } from '../../src/index.ts';

const OPTIONS = ['yes', 'no'];
const pick = (index: number, option: 'yes' | 'no'): BatchAnswer => ({
  index,
  status: 'ok',
  probabilities: option === 'yes' ? [0.9, 0.1] : [0.1, 0.9],
});
const failed = (index: number): BatchAnswer => ({ index, status: 'failed', probabilities: null });

describe('Golden', () => {
  const truths = ['yes', 'yes', 'no', 'no'];
  const byModel = {
    a: [pick(0, 'yes'), pick(1, 'yes'), pick(2, 'no'), pick(3, 'yes')],
    b: [pick(0, 'yes'), pick(1, 'no'), pick(2, 'no'), pick(3, 'yes')],
  };

  it('gives how often each pair of models picked the same option', () => {
    expect(agreement(OPTIONS, truths, byModel).pairs).toEqual([
      [1, 0.75],
      [0.75, 1],
    ]);
  });

  it('gives the share of items where all models agree', () => {
    expect(agreement(OPTIONS, truths, byModel).unanimous).toBe(0.75);
  });

  it('counts items all models got right, all got wrong, and where they split', () => {
    expect(agreement(OPTIONS, truths, byModel)).toMatchObject({ allRight: 2, allWrong: 1, split: 1 });
  });
});

describe('Edge', () => {
  it('compares a pair only over items both answered', () => {
    const result = agreement(OPTIONS, ['yes', 'yes'], {
      a: [pick(0, 'yes'), failed(1)],
      b: [pick(0, 'yes'), pick(1, 'no')],
    });

    expect(result.pairs[0]?.[1]).toBe(1);
  });

  it('leaves a pair unavailable when the two models share no answered item', () => {
    const result = agreement(OPTIONS, ['yes'], { a: [failed(0)], b: [pick(0, 'yes')] });

    expect(result.pairs[0]?.[1]).toBeNull();
    expect(result.unanimous).toBeNull();
  });
});
