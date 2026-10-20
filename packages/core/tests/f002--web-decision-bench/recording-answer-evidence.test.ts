import { describe, expect, it } from 'vitest';
import { DecisionSchema, parseResult } from '../../src/index.ts';
import { buildDecision, yesNoQuestion } from '../fixtures/decisions.ts';
import { buildAnswers, buildResult } from '../fixtures/results.ts';

const decision = DecisionSchema.parse(buildDecision({ questions: [yesNoQuestion()] }));
const usage = { calls: 2, inputTokens: 200, outputTokens: 4, costUsd: 0.002 };

function withEvidence(evidence: Record<string, unknown>) {
  const [answer] = buildAnswers(decision);
  return buildResult(decision, { answers: [{ ...answer, ...evidence }] });
}

describe('Golden', () => {
  it('accepts a logprobs answer with its residual mass, usage, and latency', () => {
    const raw = withEvidence({ source: 'logprobs', residualMass: 0.02, usage, latencyMs: 300 });

    expect(parseResult(decision, raw).data).toEqual(raw);
  });

  it('accepts a sampled answer with its runs', () => {
    const runs = [
      { answer: 'yes', reasoning: 'cues point to yes' },
      { answer: null, reasoning: null },
    ];

    expect(parseResult(decision, withEvidence({ source: 'sampled', runs, usage })).success).toBe(true);
  });
});

describe('Edge', () => {
  it('accepts a sampled run that failed with its error', () => {
    const runs = [{ answer: null, reasoning: null, error: 'OpenRouter 429 rate limited' }];

    expect(parseResult(decision, withEvidence({ source: 'sampled', runs })).success).toBe(true);
  });

  it('rejects residual mass on a sampled answer', () => {
    expect(parseResult(decision, withEvidence({ source: 'sampled', residualMass: 0.1 })).success).toBe(false);
  });

  it('rejects runs on a logprobs answer', () => {
    const runs = [{ answer: 'yes', reasoning: null }];

    expect(parseResult(decision, withEvidence({ source: 'logprobs', runs })).success).toBe(false);
  });

  it.each([
    ['a negative call count', { ...usage, calls: -1 }],
    ['fractional tokens', { ...usage, inputTokens: 1.5 }],
  ])('rejects usage with %s', (_, invalid) => {
    expect(parseResult(decision, withEvidence({ source: 'logprobs', usage: invalid })).success).toBe(false);
  });
});

describe('Adversarial', () => {
  it('rejects a run answering outside the options', () => {
    const runs = [{ answer: 'definitely', reasoning: null }];

    expect(parseResult(decision, withEvidence({ source: 'sampled', runs })).success).toBe(false);
  });

  it('rejects residual mass above 1', () => {
    expect(parseResult(decision, withEvidence({ source: 'logprobs', residualMass: 1.5 })).success).toBe(false);
  });
});
