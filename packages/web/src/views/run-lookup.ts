import { type Answer, optionsOf, type Question, type Result } from '@typed-decisions/core';
import type { BenchRun, RunModel } from '../state.ts';

export type Measured = { model: RunModel; result: Result; answer: Answer; question: Question; options: string[] };

export function questionOf(run: BenchRun, questionId: string | null): Question {
  const questions = run.decision.questions;
  return questions.find((question) => question.id === questionId) ?? (questions[0] as Question);
}

export function labelOf(run: BenchRun, modelId: string): string {
  return run.models.find((model) => model.id === modelId)?.label ?? modelId;
}

export function succeeded(run: BenchRun): Result[] {
  return run.results.filter((result) => result.status !== 'failed' && result.answers.length > 0);
}

export function measured(run: BenchRun, modelId: string, question: Question): Measured | null {
  const result = run.results.find((candidate) => candidate.model.id === modelId && candidate.status !== 'failed');
  const answer = result?.answers.find((candidate) => candidate.questionId === question.id);
  const model = run.models.find((candidate) => candidate.id === modelId);
  if (!result || !answer || !model) return null;
  return { model, result, answer, question, options: optionsOf(question) };
}

export function measuredAll(run: BenchRun, question: Question): Measured[] {
  return succeeded(run)
    .map((result) => measured(run, result.model.id, question))
    .filter((entry): entry is Measured => entry !== null);
}
