import type { TokenLogprob } from '../contracts/transport.ts';
import { optionsOf, type Question } from '../schemas/decision.ts';
import type { Distribution } from '../schemas/result.ts';
import { labelsFor, normalizeLabel } from './prompts.ts';

export type LogprobsReading = { distribution: Distribution; residualMass: number };

export function distributionFromLogprobs(tokens: TokenLogprob[], question: Question): LogprobsReading | null {
  const position = tokens.find((token) => token.token.trim() !== '');
  if (!position) return null;

  const labels = labelsFor(question).map((label) => label.toLowerCase());
  const options = optionsOf(question);
  const mass = options.map(() => 0);
  for (const alternative of position.top) {
    const index = labels.indexOf(normalizeLabel(alternative.token));
    if (index >= 0) mass[index] = (mass[index] ?? 0) + Math.exp(alternative.logprob);
  }

  const matched = mass.reduce((sum, value) => sum + value, 0);
  if (matched <= 0) return null;

  return {
    distribution: options.map((option, index) => ({ option, probability: (mass[index] ?? 0) / matched })),
    residualMass: Math.min(1, Math.max(0, 1 - matched)),
  };
}
