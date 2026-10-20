import { describe, expect, it } from 'vitest';
import { callCost, DecisionSchema, estimateDecisionCost, sumCosts } from '../../src/index.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';

const decision = DecisionSchema.parse(buildDecision({ questions: [yesNoQuestion()] }));
const pricing = { inputPerToken: 0.000001, outputPerToken: 0.000002 };
const usage = { inputTokens: 100, outputTokens: 10 };

describe('Golden', () => {
  it('uses the cost the host reports for a call', () => {
    expect(callCost({ costUsd: 0.3, usage }, pricing)).toBe(0.3);
  });

  it('computes a call cost from tokens and prices when the host reports none', () => {
    expect(callCost({ costUsd: null, usage }, pricing)).toBeCloseTo(100 * 0.000001 + 10 * 0.000002);
  });

  it('sums known costs and flags unknown ones', () => {
    expect(sumCosts([0.1, null, 0.2])).toEqual({ usd: expect.closeTo(0.3), complete: false });
  });

  it('scales an estimate with calls per question and output tokens', () => {
    const once = estimateDecisionCost(decision, [{ pricing, callsPerQuestion: 1, outputTokensPerCall: 2 }]).usd;
    const five = estimateDecisionCost(decision, [{ pricing, callsPerQuestion: 5, outputTokensPerCall: 2 }]).usd;

    expect(five).toBeCloseTo(once * 5);
  });

  it('adds the estimates of every model', () => {
    const plan = { pricing, callsPerQuestion: 1, outputTokensPerCall: 2 };
    const single = estimateDecisionCost(decision, [plan]).usd;

    expect(estimateDecisionCost(decision, [plan, plan]).usd).toBeCloseTo(single * 2);
  });
});

describe('Edge', () => {
  it('estimates free models at zero', () => {
    const free = { inputPerToken: 0, outputPerToken: 0 };

    expect(estimateDecisionCost(decision, [{ pricing: free, callsPerQuestion: 5, outputTokensPerCall: 400 }])).toEqual({
      usd: 0,
      complete: true,
    });
  });

  it('marks an estimate with variable pricing as incomplete', () => {
    expect(
      estimateDecisionCost(decision, [{ pricing: null, callsPerQuestion: 1, outputTokensPerCall: 2 }]).complete,
    ).toBe(false);
  });

  it('reports an unknown call cost when neither cost nor prices are known', () => {
    expect(callCost({ costUsd: null, usage }, null)).toBeNull();
  });

  it('sums nothing to zero', () => {
    expect(sumCosts([])).toEqual({ usd: 0, complete: true });
  });
});
