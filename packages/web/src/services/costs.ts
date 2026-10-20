import {
  type CostPlan,
  type CostTotal,
  type Decision,
  estimateDecisionCost,
  type Question,
  type RunSettings,
} from '@typed-decisions/core';
import { type ModelEntry, probabilitySource, reasons } from './registry.ts';

const ANSWER_TOKENS = 2;
const REASONING_TOKENS = 400;
const CENT = 0.01;

export function planFor(entry: ModelEntry, settings: RunSettings): CostPlan {
  const sampled = probabilitySource(entry) === 'sampled';
  return {
    pricing: entry.pricing,
    callsPerQuestion: sampled ? settings.samples : 1,
    outputTokensPerCall: sampled && reasons(entry, settings) ? REASONING_TOKENS : ANSWER_TOKENS,
  };
}

export function estimateRun(decision: Decision, entries: ModelEntry[], settings: RunSettings): CostTotal {
  return estimateDecisionCost(
    decision,
    entries.map((entry) => planFor(entry, settings)),
  );
}

export function estimateEach(
  inputs: Decision['input'][],
  question: Question,
  entries: ModelEntry[],
  settings: RunSettings,
): CostTotal {
  const quiet = { ...settings, reasoning: false };
  const totals = inputs.map((input) => estimateRun({ input, questions: [question] }, entries, quiet));
  return {
    usd: totals.reduce((sum, total) => sum + total.usd, 0),
    complete: totals.every((total) => total.complete),
  };
}

export function money(usd: number): string {
  if (usd === 0) return '$0';
  return `$${usd >= CENT ? usd.toFixed(3) : usd.toFixed(4)}`;
}

export function costLabel(total: CostTotal): string {
  return total.complete ? money(total.usd) : `${money(total.usd)} + variable`;
}

export function maybeMoney(usd: number | null): string {
  return usd === null ? '—' : money(usd);
}
