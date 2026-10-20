import type { BatchItem } from '@typed-decisions/core';
import { type BatchAnswer, InputSchema, optionsOf, type Question, QuestionSchema } from '@typed-decisions/core';
import { z } from 'zod';
import type { ProbabilitySource } from './registry.ts';

export type CalibrationModel = { id: string; label: string; source: ProbabilitySource };

export type StoredCalibration = {
  calibrationId: string;
  draftKey: string;
  createdAt: string;
  stopped: boolean;
  meta: { name: string; id: string; version: number };
  question: Question;
  settings: { samples: number; seed: number };
  models: CalibrationModel[];
  items: BatchItem[];
  byModel: Record<string, BatchAnswer[]>;
};

export const CALIBRATION_STORAGE = 'decisionBench.calibrations';

const AnswerSchema = z.object({
  index: z.int().nonnegative(),
  status: z.enum(['ok', 'failed', 'stopped']),
  probabilities: z.array(z.number().min(0).max(1)).nullable(),
});

const StoredCalibrationSchema = z.object({
  calibrationId: z.string().min(1),
  draftKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  stopped: z.boolean(),
  meta: z.object({ name: z.string(), id: z.string(), version: z.number() }),
  question: QuestionSchema,
  settings: z.object({ samples: z.int().positive(), seed: z.int() }),
  models: z.array(z.object({ id: z.string(), label: z.string(), source: z.enum(['logprobs', 'sampled']) })),
  items: z.array(z.object({ input: InputSchema, truth: z.string() })),
  byModel: z.record(z.string(), z.array(AnswerSchema)),
});

export function newestCalibrationFirst(a: StoredCalibration, b: StoredCalibration) {
  return b.createdAt.localeCompare(a.createdAt);
}

function fitsQuestion(calibration: StoredCalibration): boolean {
  const options = optionsOf(calibration.question);
  const truthsFit = calibration.items.every((item) => options.includes(item.truth));
  const answersFit = Object.values(calibration.byModel).every((answers) =>
    answers.every(
      (answer) =>
        answer.index < calibration.items.length &&
        (answer.status === 'ok') === (answer.probabilities !== null) &&
        (answer.probabilities === null || answer.probabilities.length === options.length),
    ),
  );
  return truthsFit && answersFit;
}

function validCalibration(raw: unknown): StoredCalibration | null {
  const parsed = StoredCalibrationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const calibration = parsed.data as StoredCalibration;
  return fitsQuestion(calibration) ? calibration : null;
}

export function validCalibrations(raw: unknown[]): StoredCalibration[] {
  return raw
    .map(validCalibration)
    .filter((calibration): calibration is StoredCalibration => calibration !== null)
    .sort(newestCalibrationFirst);
}

export function addCalibration(history: StoredCalibration[], calibration: StoredCalibration): StoredCalibration[] {
  return [calibration, ...history.filter((entry) => entry.calibrationId !== calibration.calibrationId)].sort(
    newestCalibrationFirst,
  );
}

export function calibrationsOf(history: StoredCalibration[], draftKey: string): StoredCalibration[] {
  return history.filter((entry) => entry.draftKey === draftKey).sort(newestCalibrationFirst);
}

export function deleteCalibration(history: StoredCalibration[], calibrationId: string): StoredCalibration[] {
  return history.filter((entry) => entry.calibrationId !== calibrationId);
}

export function deleteCalibrationsOf(history: StoredCalibration[], draftKey: string): StoredCalibration[] {
  return history.filter((entry) => entry.draftKey !== draftKey);
}
