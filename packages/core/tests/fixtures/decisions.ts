import type { Question } from '../../src/index.ts';

export function choiceQuestion(overrides: Partial<Question> = {}) {
  return { id: 'tier', type: 'choice', prompt: 'Which tier fits?', options: ['low', 'mid', 'high'], ...overrides };
}

export function yesNoQuestion(overrides: Partial<Question> = {}) {
  return { id: 'approve', type: 'yes-no', prompt: 'Approve the request?', ...overrides };
}

export function scoreQuestion(overrides: Partial<Question> = {}) {
  return { id: 'risk', type: 'score', prompt: 'How risky is it?', min: 1, max: 5, ...overrides };
}

export function buildDecision(overrides: Record<string, unknown> = {}) {
  return {
    input: { kind: 'text', text: 'A customer asks for a credit line increase.' },
    questions: [choiceQuestion(), yesNoQuestion(), scoreQuestion()],
    ...overrides,
  };
}
