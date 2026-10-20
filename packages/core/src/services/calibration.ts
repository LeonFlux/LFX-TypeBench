import type { BatchAnswer } from './batch.ts';
import {
  argmax,
  brierScore,
  CALIBRATION_BINS,
  calibrationBins,
  expectedCalibrationError,
  type Scored,
} from './metrics.ts';

export const CONFIDENTLY_WRONG = 0.8;

export type ModelScores = {
  answered: number;
  failed: number;
  accuracy: number | null;
  meanConfidence: number | null;
  gap: number | null;
  ece: number | null;
  brier: number | null;
};

export type OptionStats = {
  option: string;
  support: number;
  picked: number;
  precision: number | null;
  recall: number | null;
};

export type Agreement = {
  ids: string[];
  pairs: (number | null)[][];
  unanimous: number | null;
  allRight: number;
  allWrong: number;
  split: number;
};

export type ItemFilter = 'all' | 'wrong' | 'confidently-wrong' | 'disagree' | 'all-wrong' | 'failed';

export type Drill = { bin: number } | { truth: string; predicted: string } | null;

type Answered = { index: number; probabilities: number[] };

const share = (part: number, whole: number) => (whole ? part / whole : null);

function answeredOf(answers: readonly BatchAnswer[]): Answered[] {
  return answers.filter((answer): answer is Answered & BatchAnswer => answer.status === 'ok' && !!answer.probabilities);
}

const confidenceOf = (probabilities: number[]) => probabilities[argmax(probabilities)] ?? 0;

export function binOf(confidence: number): number {
  return Math.min(CALIBRATION_BINS - 1, Math.floor(confidence * CALIBRATION_BINS));
}

export function modelScores(options: string[], truths: string[], answers: readonly BatchAnswer[]): ModelScores {
  const scored: Scored[] = answeredOf(answers).map((answer) => ({
    truth: truths[answer.index] ?? '',
    options,
    probabilities: answer.probabilities,
  }));
  const failed = answers.length - scored.length;
  if (!scored.length) {
    return { answered: 0, failed, accuracy: null, meanConfidence: null, gap: null, ece: null, brier: null };
  }
  const correct = scored.filter((item) => options[argmax(item.probabilities)] === item.truth).length;
  const accuracy = correct / scored.length;
  const meanConfidence = scored.reduce((sum, item) => sum + confidenceOf(item.probabilities), 0) / scored.length;
  return {
    answered: scored.length,
    failed,
    accuracy,
    meanConfidence,
    gap: meanConfidence - accuracy,
    ece: expectedCalibrationError(calibrationBins(scored)),
    brier: brierScore(scored),
  };
}

export function optionBreakdown(options: string[], truths: string[], answers: readonly BatchAnswer[]): OptionStats[] {
  const answered = answeredOf(answers).map((answer) => ({
    truth: truths[answer.index],
    pick: options[argmax(answer.probabilities)],
  }));
  return options.map((option) => {
    const support = answered.filter((item) => item.truth === option).length;
    const picked = answered.filter((item) => item.pick === option).length;
    const right = answered.filter((item) => item.pick === option && item.truth === option).length;
    return { option, support, picked, precision: share(right, picked), recall: share(right, support) };
  });
}

function picksByModel(byModel: Record<string, readonly BatchAnswer[]>): Map<string, Map<number, number>> {
  return new Map(
    Object.entries(byModel).map(([id, answers]) => [
      id,
      new Map(answeredOf(answers).map((answer) => [answer.index, argmax(answer.probabilities)])),
    ]),
  );
}

export function agreement(
  options: string[],
  truths: string[],
  byModel: Record<string, readonly BatchAnswer[]>,
): Agreement {
  const ids = Object.keys(byModel);
  const picks = picksByModel(byModel);
  const pickOf = (id: string) => picks.get(id) ?? new Map<number, number>();

  const pairs = ids.map((a) =>
    ids.map((b) => {
      const shared = [...pickOf(a).keys()].filter((index) => pickOf(b).has(index));
      return share(shared.filter((index) => pickOf(a).get(index) === pickOf(b).get(index)).length, shared.length);
    }),
  );

  const common = truths.map((_, index) => index).filter((index) => ids.every((id) => pickOf(id).has(index)));
  let unanimous = 0;
  let allRight = 0;
  let allWrong = 0;
  for (const index of common) {
    const chosen = ids.map((id) => pickOf(id).get(index) ?? -1);
    if (new Set(chosen).size === 1) unanimous++;
    const right = chosen.filter((pick) => options[pick] === truths[index]).length;
    if (right === ids.length) allRight++;
    else if (right === 0) allWrong++;
  }
  return {
    ids,
    pairs,
    unanimous: share(unanimous, common.length),
    allRight,
    allWrong,
    split: common.length - allRight - allWrong,
  };
}

type MatchRequest = {
  options: string[];
  truths: string[];
  byModel: Record<string, readonly BatchAnswer[]>;
  modelId: string;
  filter: ItemFilter;
  drill: Drill;
};

export function itemsMatching({ options, truths, byModel, modelId, filter, drill }: MatchRequest): number[] {
  const own = byModel[modelId];
  if (!own) return [];
  const answerAt = (answers: readonly BatchAnswer[], index: number) =>
    answeredOf(answers).find((answer) => answer.index === index) ?? null;
  const isWrong = (answer: Answered, index: number) => options[argmax(answer.probabilities)] !== truths[index];

  const matchesFilter = (index: number, mine: Answered | null): boolean => {
    const others = Object.values(byModel)
      .map((answers) => answerAt(answers, index))
      .filter((answer): answer is Answered => answer !== null);
    switch (filter) {
      case 'all':
        return true;
      case 'wrong':
        return !!mine && isWrong(mine, index);
      case 'confidently-wrong':
        return !!mine && isWrong(mine, index) && confidenceOf(mine.probabilities) >= CONFIDENTLY_WRONG;
      case 'disagree':
        return others.length > 1 && new Set(others.map((answer) => argmax(answer.probabilities))).size > 1;
      case 'all-wrong':
        return others.length > 0 && others.every((answer) => isWrong(answer, index));
      case 'failed':
        return !mine;
    }
  };

  const matchesDrill = (index: number, mine: Answered | null): boolean => {
    if (!drill) return true;
    if (!mine) return false;
    if ('bin' in drill) return binOf(confidenceOf(mine.probabilities)) === drill.bin;
    return truths[index] === drill.truth && options[argmax(mine.probabilities)] === drill.predicted;
  };

  return truths
    .map((_, index) => index)
    .filter((index) => {
      const mine = answerAt(own, index);
      return matchesFilter(index, mine) && matchesDrill(index, mine);
    });
}
