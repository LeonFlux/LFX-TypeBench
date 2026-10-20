import { describe, expect, it } from 'vitest';
import { type BatchAnswer, modelScores, optionBreakdown } from '../../src/index.ts';

const OPTIONS = ['yes', 'no'];
const ok = (index: number, yes: number): BatchAnswer => ({ index, status: 'ok', probabilities: [yes, 1 - yes] });
const failed = (index: number): BatchAnswer => ({ index, status: 'failed', probabilities: null });

describe('Golden', () => {
  const truths = ['yes', 'yes', 'no', 'no'];
  const answers = [ok(0, 0.9), ok(1, 0.7), ok(2, 0.8), failed(3)];

  it('scores accuracy over the answered items only', () => {
    expect(modelScores(OPTIONS, truths, answers).accuracy).toBeCloseTo(2 / 3);
  });

  it('gives the overconfidence gap as mean confidence minus accuracy', () => {
    const scores = modelScores(OPTIONS, truths, answers);

    expect(scores.meanConfidence).toBeCloseTo(0.8);
    expect(scores.gap).toBeCloseTo(0.8 - 2 / 3);
  });

  it('counts answered and failed items', () => {
    expect(modelScores(OPTIONS, truths, answers)).toMatchObject({ answered: 3, failed: 1 });
  });

  it('scores Brier and ECE from the answered items', () => {
    const scores = modelScores(OPTIONS, ['yes'], [ok(0, 1)]);

    expect(scores.brier).toBe(0);
    expect(scores.ece).toBe(0);
  });

  it('gives each option its support, picks, precision, and recall', () => {
    const breakdown = optionBreakdown(
      OPTIONS,
      ['yes', 'yes', 'no', 'no'],
      [ok(0, 0.9), ok(1, 0.2), ok(2, 0.6), ok(3, 0.1)],
    );

    expect(breakdown).toEqual([
      { option: 'yes', support: 2, picked: 2, precision: 0.5, recall: 0.5 },
      { option: 'no', support: 2, picked: 2, precision: 0.5, recall: 0.5 },
    ]);
  });
});

describe('Edge', () => {
  it('reads every score as unavailable when nothing was answered', () => {
    expect(modelScores(OPTIONS, ['yes', 'no'], [failed(0), failed(1)])).toEqual({
      answered: 0,
      failed: 2,
      accuracy: null,
      meanConfidence: null,
      gap: null,
      ece: null,
      brier: null,
    });
  });

  it('counts stopped items as not answered', () => {
    const stopped: BatchAnswer = { index: 1, status: 'stopped', probabilities: null };

    expect(modelScores(OPTIONS, ['yes', 'yes'], [ok(0, 0.9), stopped])).toMatchObject({ answered: 1, failed: 1 });
  });

  it('leaves precision unavailable for an option never picked', () => {
    const [, no] = optionBreakdown(OPTIONS, ['yes', 'no'], [ok(0, 0.9), ok(1, 0.9)]);

    expect(no).toMatchObject({ picked: 0, precision: null, recall: 0 });
  });

  it('leaves recall unavailable for an option no item has as truth', () => {
    const [, no] = optionBreakdown(OPTIONS, ['yes', 'yes'], [ok(0, 0.9), ok(1, 0.1)]);

    expect(no).toMatchObject({ support: 0, recall: null, precision: 0 });
  });
});

describe('Adversarial', () => {
  it('ignores a truth that is not one of the options', () => {
    const [yes] = optionBreakdown(OPTIONS, ['maybe'], [ok(0, 0.9)]);

    expect(yes).toMatchObject({ support: 0, picked: 1, precision: 0 });
  });
});
