import { describe, expect, it } from 'vitest';
import type { Model } from '../contracts/model.ts';
import { type Decision, DecisionSchema } from '../schemas/decision.ts';
import { parseResult, type Result } from '../schemas/result.ts';

const CONTRACT_DECISION = DecisionSchema.parse({
  input: { kind: 'text', text: 'A customer asks for a credit line increase.' },
  questions: [
    { id: 'tier', type: 'choice', prompt: 'Which tier fits?', options: ['low', 'mid', 'high'] },
    { id: 'approve', type: 'yes-no', prompt: 'Approve the request?' },
    { id: 'risk', type: 'score', prompt: 'How risky is it?', min: 1, max: 5 },
  ],
});

function identityViolations(model: Model, result: Result) {
  const violations: string[] = [];
  if (result.model.id !== model.id) violations.push(`Result names model ${result.model.id}, not ${model.id}`);
  if (result.model.version !== model.version) violations.push(`Result names version ${result.model.version}`);
  if (result.transport.id !== model.transport.id) violations.push(`Result names transport ${result.transport.id}`);
  return violations;
}

export async function checkModelContract(model: Model, decision: Decision): Promise<string[]> {
  let raw: unknown;
  try {
    raw = await model.decide(decision);
  } catch (error) {
    return [`decide threw: ${error instanceof Error ? error.message : String(error)}`];
  }

  const parsed = parseResult(decision, raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  return identityViolations(model, parsed.data);
}

export function describeModelContract(name: string, createModel: () => Model, decision = CONTRACT_DECISION) {
  describe(`${name} satisfies the model contract`, () => {
    it('returns a result that parses against the decision and names its model and transport', async () => {
      expect(await checkModelContract(createModel(), decision)).toEqual([]);
    });
  });
}
