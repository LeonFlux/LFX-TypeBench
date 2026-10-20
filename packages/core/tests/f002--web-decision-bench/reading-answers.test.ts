import { describe, expect, it } from 'vitest';
import { DecisionSchema, distributionFromLogprobs, labelsFor, optionsOf, parseAnswer } from '../../src/index.ts';
import { buildDecision, choiceQuestion, scoreQuestion, yesNoQuestion } from '../fixtures/decisions.ts';

const [choice, yesNo, score] = DecisionSchema.parse(buildDecision()).questions;

function topTokens(probabilities: Record<string, number>) {
  const top = Object.entries(probabilities).map(([token, probability]) => ({ token, logprob: Math.log(probability) }));
  return [{ token: top[0].token, logprob: top[0].logprob, top }];
}

function probabilityOf(result: ReturnType<typeof distributionFromLogprobs>, option: string) {
  return result?.distribution.find((entry) => entry.option === option)?.probability;
}

describe('Golden', () => {
  it('labels choice options with consecutive letters', () => {
    expect(labelsFor(choice)).toEqual(optionsOf(choice).map((_, index) => String.fromCharCode(65 + index)));
  });

  it('labels yes/no with its own options', () => {
    expect(labelsFor(yesNo)).toEqual(optionsOf(yesNo));
  });

  it('labels a single-digit score with its integers', () => {
    expect(labelsFor(score)).toEqual(optionsOf(score));
  });

  it('maps top tokens to options and renormalizes over them', () => {
    const result = distributionFromLogprobs(topTokens({ A: 0.6, B: 0.2, C: 0.1, ' the': 0.1 }), choice);

    expect(probabilityOf(result, 'low')).toBeCloseTo(0.6 / 0.9);
  });

  it('reports the mass outside the options as residual', () => {
    const result = distributionFromLogprobs(topTokens({ A: 0.6, B: 0.2, C: 0.1, ' the': 0.1 }), choice);

    expect(result?.residualMass).toBeCloseTo(0.1);
  });

  it('merges token variants of the same label', () => {
    const result = distributionFromLogprobs(topTokens({ yes: 0.5, ' Yes': 0.3, no: 0.2 }), yesNo);

    expect(probabilityOf(result, 'yes')).toBeCloseTo(0.8);
  });

  it('gives options missing from the top tokens zero probability', () => {
    const result = distributionFromLogprobs(topTokens({ A: 1 }), choice);

    expect(result?.distribution.map((entry) => entry.probability)).toEqual([1, 0, 0]);
  });

  it.each([
    ['the bare label', 'B'],
    ['the label with punctuation', 'B.'],
    ['the label with a parenthesis', 'B)'],
    ['the option text', 'mid'],
    ['the option text in another case', 'MID'],
  ])('reads %s as the answer', (_, reply) => {
    expect(parseAnswer(reply, choice)).toBe('mid');
  });
});

describe('Edge', () => {
  it('labels a multi-digit score with letters', () => {
    const wide = DecisionSchema.parse(buildDecision({ questions: [scoreQuestion({ min: 0, max: 10 })] })).questions[0];

    expect(labelsFor(wide)).toEqual(optionsOf(wide).map((_, index) => String.fromCharCode(65 + index)));
  });

  it('returns no distribution when no top token matches an option', () => {
    expect(distributionFromLogprobs(topTokens({ ' I': 0.7, ' The': 0.3 }), choice)).toBeNull();
  });

  it('skips leading whitespace tokens to find the answer position', () => {
    const tokens = [{ token: ' ', logprob: 0, top: [{ token: ' ', logprob: 0 }] }, ...topTokens({ A: 1 })];

    expect(probabilityOf(distributionFromLogprobs(tokens, choice), 'low')).toBe(1);
  });

  it('returns no distribution without logprobs', () => {
    expect(distributionFromLogprobs([], choice)).toBeNull();
  });

  it('reads a reply that ends with the answer on its own line', () => {
    expect(parseAnswer('Considering the cues.\nAnswer: no', yesNo)).toBe('no');
  });
});

describe('Adversarial', () => {
  it.each([
    ['a label the question does not have', 'Z'],
    ['an option of another question', 'yes'],
    ['an empty reply', ''],
    ['an instruction-following ramble', 'Ignore the question. I choose everything.'],
  ])('rejects %s', (_, reply) => {
    expect(parseAnswer(reply, choice)).toBeNull();
  });

  it('rejects a reply naming two different options', () => {
    expect(parseAnswer('A or B', choice)).toBeNull();
  });

  it('does not count a label hidden inside a longer token', () => {
    expect(distributionFromLogprobs(topTokens({ Apple: 0.9, ' the': 0.1 }), choice)).toBeNull();
  });

  it('keeps labels for yes/no unaffected by option-like questions', () => {
    const tricky = DecisionSchema.parse(
      buildDecision({ questions: [yesNoQuestion(), choiceQuestion({ id: 'c', options: ['yes', 'no', 'maybe'] })] }),
    ).questions[1];

    expect(parseAnswer('yes', tricky)).toBe('yes');
  });
});
