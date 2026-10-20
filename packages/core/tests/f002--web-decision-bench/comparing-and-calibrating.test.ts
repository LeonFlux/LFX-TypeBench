import { describe, expect, it } from 'vitest';
import {
  accuracyOf,
  brierScore,
  ChatModel,
  calibrationBins,
  confusionMatrix,
  consensus,
  DecisionSchema,
  diffHalfWidth,
  divergenceMatrix,
  expectedCalibrationError,
  jsDivergence,
  marginOfError,
  runBatch,
  stableStringify,
} from '../../src/index.ts';
import { logprobsReply, scriptedTransport } from '../fakes/scripted-transport.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';

const OPTIONS = ['yes', 'no'];
const settings = { samples: 2, seed: 1, reasoning: false, concurrency: 2 };

describe('Golden', () => {
  it('measures no divergence between identical distributions', () => {
    expect(jsDivergence([0.5, 0.5], [0.5, 0.5])).toBe(0);
  });

  it('measures full divergence between disjoint distributions', () => {
    expect(jsDivergence([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it('finds the most divergent pair', () => {
    const matrix = divergenceMatrix([
      { id: 'a', probabilities: [0.9, 0.1] },
      { id: 'b', probabilities: [0.6, 0.4] },
      { id: 'c', probabilities: [0.1, 0.9] },
    ]);

    expect(matrix.maxPair).toMatchObject({ a: 'a', b: 'c' });
  });

  it('counts the consensus over top answers', () => {
    expect(consensus(['A', 'A', 'B'])).toEqual({ answer: 'A', count: 2, total: 3, unanimous: false });
  });

  it('agrees on a hand-checked batch', () => {
    const items = [
      { truth: 'yes', options: OPTIONS, probabilities: [0.9, 0.1] },
      { truth: 'yes', options: OPTIONS, probabilities: [0.8, 0.2] },
      { truth: 'no', options: OPTIONS, probabilities: [0.85, 0.15] },
      { truth: 'no', options: OPTIONS, probabilities: [0.35, 0.65] },
    ];
    const matrix = confusionMatrix(OPTIONS, items);
    const bins = calibrationBins(items);

    expect({ matrix, accuracy: accuracyOf(matrix), ece: expectedCalibrationError(bins) }).toEqual({
      matrix: [
        [2, 0],
        [1, 1],
      ],
      accuracy: 0.75,
      ece: expect.closeTo((Math.abs(1 - 0.9) + Math.abs(0.5 - 0.825) * 2 + Math.abs(1 - 0.65)) / 4),
    });
  });

  it('scores a perfect forecast with a Brier score of 0', () => {
    expect(brierScore([{ truth: 'yes', options: OPTIONS, probabilities: [1, 0] }])).toBe(0);
  });

  it('runs every model over every batch item', async () => {
    const decision = DecisionSchema.parse(buildDecision({ questions: [yesNoQuestion()] }));
    const transport = scriptedTransport(() => logprobsReply({ yes: 0.8, no: 0.2 }));
    const model = new ChatModel({
      id: 'm',
      version: 'm-1',
      capabilities: ['probabilities'],
      transport,
      profile: { temperature: true, seed: true, reasoning: null },
    });
    const items = ['first', 'second', 'third'].map((text, index) => ({
      input: { kind: 'text' as const, text },
      truth: OPTIONS[index % 2] ?? 'yes',
    }));

    const outcome = await runBatch({ decision, models: [model], questionId: 'approve', items, settings });

    expect(outcome.byModel.m?.map((answer) => [answer.index, answer.status])).toEqual([
      [0, 'ok'],
      [1, 'ok'],
      [2, 'ok'],
    ]);
  });
});

describe('Edge', () => {
  it('gives the 95% margin of error of a proportion near 50%', () => {
    expect(marginOfError(100)).toBeCloseTo(0.098);
  });

  it('gives no margin without samples', () => {
    expect(marginOfError(0)).toBe(0);
  });

  it('shrinks the sampling noise band with more samples', () => {
    expect(diffHalfWidth(0.5, 0.5, 20)).toBeGreaterThan(diffHalfWidth(0.5, 0.5, 80));
  });

  it('reports zero calibration error on an empty batch', () => {
    expect(expectedCalibrationError(calibrationBins([]))).toBe(0);
  });

  it('serializes objects independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it('ignores items whose truth is not an option in the confusion matrix', () => {
    expect(confusionMatrix(OPTIONS, [{ truth: 'maybe', options: OPTIONS, probabilities: [1, 0] }]).flat()).toEqual([
      0, 0, 0, 0,
    ]);
  });
});
