import { type Decision, optionsOf } from '../../src/index.ts';

export function uniformDistribution(options: string[]) {
  return options.map((option) => ({ option, probability: 1 / options.length }));
}

export function buildAnswers(decision: Decision) {
  return decision.questions.map((question) => {
    const options = optionsOf(question);
    return { questionId: question.id, choice: options[0], distribution: uniformDistribution(options) };
  });
}

export function buildResult(decision: Decision, overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    model: { id: 'fake-model', version: '2026-10-01' },
    transport: { id: 'fake-transport' },
    answers: buildAnswers(decision),
    latencyMs: 120,
    costUsd: 0.0004,
    ...overrides,
  };
}

export function buildFailedResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'failed',
    model: { id: 'fake-model', version: '2026-10-01' },
    transport: { id: 'fake-transport' },
    error: 'The host timed out.',
    latencyMs: 30000,
    costUsd: null,
    ...overrides,
  };
}
