import type { TokenUsage } from '../contracts/transport.ts';
import { buildMessages } from '../models/prompts.ts';
import type { Decision, Question } from '../schemas/decision.ts';

export type Pricing = { inputPerToken: number; outputPerToken: number };

export type CostTotal = { usd: number; complete: boolean };

export type CostPlan = { pricing: Pricing | null; callsPerQuestion: number; outputTokensPerCall: number };

type Billed = { costUsd: number | null; usage?: TokenUsage };

const CHARS_PER_TOKEN = 4;

export function callCost(call: Billed, pricing: Pricing | null): number | null {
  if (call.costUsd !== null) return call.costUsd;
  if (!pricing || !call.usage) return null;
  return call.usage.inputTokens * pricing.inputPerToken + call.usage.outputTokens * pricing.outputPerToken;
}

export function sumCosts(costs: (number | null)[]): CostTotal {
  const known = costs.filter((cost): cost is number => cost !== null);
  return { usd: known.reduce((sum, cost) => sum + cost, 0), complete: known.length === costs.length };
}

export function promptTokens(input: Decision['input'], question: Question): number {
  const characters = buildMessages(input, question).reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

function planCost(decision: Decision, plan: CostPlan): number | null {
  const { pricing, callsPerQuestion, outputTokensPerCall } = plan;
  if (!pricing) return null;
  return decision.questions.reduce((sum, question) => {
    const perCall =
      promptTokens(decision.input, question) * pricing.inputPerToken + outputTokensPerCall * pricing.outputPerToken;
    return sum + callsPerQuestion * perCall;
  }, 0);
}

export function estimateDecisionCost(decision: Decision, plans: CostPlan[]): CostTotal {
  return sumCosts(plans.map((plan) => planCost(decision, plan)));
}
