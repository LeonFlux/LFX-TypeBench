import { describe, expect, it } from 'vitest';
import { type Decision, DecisionSchema, optionsOf, PROBABILITY_TOLERANCE, parseResult } from '../../src/index.ts';
import { buildDecision } from '../fixtures/decisions.ts';
import { buildAnswers, buildFailedResult, buildResult } from '../fixtures/results.ts';

const decision: Decision = DecisionSchema.parse(buildDecision());
const [firstQuestion] = decision.questions;
const firstOptions = optionsOf(firstQuestion);

function withFirstAnswer(changes: Record<string, unknown>) {
  const [first, ...rest] = buildAnswers(decision);
  return buildResult(decision, { answers: [{ ...first, ...changes }, ...rest] });
}

function withFirstDistribution(probabilities: number[]) {
  const distribution = firstOptions.map((option, index) => ({ option, probability: probabilities[index] ?? 0 }));
  return withFirstAnswer({ distribution });
}

function evenSplitExcept(probability: number) {
  const remainder = (1 - probability) / (firstOptions.length - 1);
  return [probability, ...firstOptions.slice(1).map(() => remainder)];
}

describe('Golden', () => {
  it('accepts a result answering every question with a choice and a distribution', () => {
    const raw = buildResult(decision);

    const parsed = parseResult(decision, raw);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(raw);
  });
});

describe('Edge', () => {
  it('accepts an answer without probabilities, marking its distribution unavailable', () => {
    const parsed = parseResult(decision, withFirstAnswer({ distribution: null }));

    expect(parsed.data?.answers[0].distribution).toBeNull();
  });

  it('accepts a failed call with its error message and no answers', () => {
    const raw = buildFailedResult();

    const parsed = parseResult(decision, raw);

    expect(parsed.data).toEqual({ ...raw, answers: [] });
  });

  it('rejects a failed call without an error message', () => {
    expect(parseResult(decision, buildFailedResult({ error: ' ' })).success).toBe(false);
  });

  it('rejects a failed call that still carries answers', () => {
    expect(parseResult(decision, buildFailedResult({ answers: buildAnswers(decision) })).success).toBe(false);
  });

  it('rejects a distribution that does not sum to 1', () => {
    const short = 1 - PROBABILITY_TOLERANCE * 10;

    expect(parseResult(decision, withFirstDistribution(evenSplitExcept(0).map((p) => p * short))).success).toBe(false);
  });

  it('accepts a distribution off from 1 by less than the tolerance', () => {
    const nearlyOne = 1 - PROBABILITY_TOLERANCE / 2;

    expect(parseResult(decision, withFirstDistribution(evenSplitExcept(0).map((p) => p * nearlyOne))).success).toBe(
      true,
    );
  });

  it('rejects a distribution missing one of the options', () => {
    const [, ...partial] = buildAnswers(decision)[0].distribution;
    const renormalized = partial.map(({ option }) => ({ option, probability: 1 / partial.length }));

    expect(parseResult(decision, withFirstAnswer({ distribution: renormalized })).success).toBe(false);
  });

  it('rejects a distribution listing an option twice', () => {
    const doubled = [...firstOptions, firstOptions[0]].map((option, _, all) => ({
      option,
      probability: 1 / all.length,
    }));

    expect(parseResult(decision, withFirstAnswer({ distribution: doubled })).success).toBe(false);
  });

  it('rejects a result answering only some questions', () => {
    const raw = buildResult(decision, { answers: buildAnswers(decision).slice(1) });

    expect(parseResult(decision, raw).success).toBe(false);
  });

  it('rejects a result answering the same question twice', () => {
    const answers = buildAnswers(decision);

    expect(parseResult(decision, buildResult(decision, { answers: [...answers, answers[0]] })).success).toBe(false);
  });

  it('rejects a result without a pinned model version', () => {
    const raw = buildResult(decision, { model: { id: 'fake-model', version: '' } });

    expect(parseResult(decision, raw).success).toBe(false);
  });

  it.each([
    ['a negative latency', { latencyMs: -1 }],
    ['a negative cost', { costUsd: -0.01 }],
  ])('rejects %s', (_, overrides) => {
    expect(parseResult(decision, buildResult(decision, overrides)).success).toBe(false);
  });
});

describe('Adversarial', () => {
  it('rejects a choice the question does not offer', () => {
    const parsed = parseResult(decision, withFirstAnswer({ choice: 'unlisted' }));

    expect(parsed.success).toBe(false);
    expect(parsed.data).toBeUndefined();
  });

  it('rejects an answer to a question the decision does not have', () => {
    const raw = buildResult(decision, {
      answers: [...buildAnswers(decision), { ...buildAnswers(decision)[0], questionId: 'injected' }],
    });

    expect(parseResult(decision, raw).success).toBe(false);
  });

  it('rejects a distribution over options the question does not offer', () => {
    const foreign = firstOptions.map((option, index) => ({
      option: index === 0 ? 'unlisted' : option,
      probability: 1 / firstOptions.length,
    }));

    expect(parseResult(decision, withFirstAnswer({ distribution: foreign })).success).toBe(false);
  });

  it.each([
    ['negative', -0.1],
    ['above 1', 1.5],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('rejects a probability that is %s', (_, probability) => {
    expect(parseResult(decision, withFirstDistribution(evenSplitExcept(probability))).success).toBe(false);
  });

  it('rejects a numeric choice where the option is a string', () => {
    const scoreIndex = decision.questions.findIndex((question) => question.type === 'score');
    const answers = buildAnswers(decision);
    answers[scoreIndex] = { ...answers[scoreIndex], choice: Number(answers[scoreIndex].choice) as unknown as string };

    expect(parseResult(decision, buildResult(decision, { answers })).success).toBe(false);
  });

  it('rejects unknown fields on the result', () => {
    expect(parseResult(decision, { ...buildResult(decision), html: '<img src=x onerror=alert(1)>' }).success).toBe(
      false,
    );
  });

  it('keeps markup in an error message as plain text', () => {
    const error = '<script>alert(1)</script>';

    expect(parseResult(decision, buildFailedResult({ error })).data).toMatchObject({ error });
  });
});
