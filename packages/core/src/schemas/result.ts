import { z } from 'zod';
import { PROBABILITY_TOLERANCE } from '../limits.ts';
import { type Decision, optionsOf } from './decision.ts';
import { NonBlankSchema } from './text.ts';

const DistributionSchema = z.array(
  z.strictObject({
    option: z.string(),
    probability: z.number().min(0).max(1),
  }),
);

const UsageSchema = z.strictObject({
  calls: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});

const RunSchema = z.strictObject({
  answer: z.string().nullable(),
  reasoning: z.string().nullable(),
  error: z.string().optional(),
});

const AnswerSchema = z
  .strictObject({
    questionId: z.string(),
    choice: z.string(),
    distribution: DistributionSchema.nullable(),
    source: z.enum(['logprobs', 'sampled']).optional(),
    residualMass: z.number().min(0).max(1).optional(),
    runs: z.array(RunSchema).optional(),
    usage: UsageSchema.optional(),
    latencyMs: z.number().nonnegative().optional(),
  })
  .refine((answer) => answer.residualMass === undefined || answer.source === 'logprobs', {
    message: 'Residual mass only belongs to logprobs answers',
    path: ['residualMass'],
  })
  .refine((answer) => answer.runs === undefined || answer.source === 'sampled', {
    message: 'Runs only belong to sampled answers',
    path: ['runs'],
  });

const resultFields = {
  model: z.strictObject({ id: NonBlankSchema, version: NonBlankSchema }),
  transport: z.strictObject({ id: NonBlankSchema }),
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
};

const OkResultSchema = z.strictObject({
  ...resultFields,
  status: z.literal('ok'),
  answers: z.array(AnswerSchema),
});

const FailedResultSchema = z.strictObject({
  ...resultFields,
  status: z.literal('failed'),
  error: NonBlankSchema,
  answers: z.array(AnswerSchema).max(0).default([]),
});

const StoppedResultSchema = z.strictObject({
  ...resultFields,
  status: z.literal('stopped'),
  answers: z.array(AnswerSchema),
});

export const ResultSchema = z.discriminatedUnion('status', [OkResultSchema, FailedResultSchema, StoppedResultSchema]);

export type Answer = z.infer<typeof AnswerSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Distribution = z.infer<typeof DistributionSchema>;
export type Result = z.infer<typeof ResultSchema>;

type Issue = { path: (string | number)[]; message: string };

function coverageIssues(decision: Decision, answers: Answer[], complete: boolean): Issue[] {
  const answered = answers.map((answer) => answer.questionId);
  const duplicated = new Set(answered).size !== answered.length;
  const missing = complete ? decision.questions.filter((question) => !answered.includes(question.id)) : [];

  const issues = missing.map((question) => ({ path: ['answers'], message: `Question ${question.id} is not answered` }));
  if (duplicated) issues.push({ path: ['answers'], message: 'Each question must be answered once' });
  return issues;
}

function distributionIssues(options: string[], distribution: Distribution | null, path: Issue['path']): Issue[] {
  if (distribution === null) return [];

  const listed = distribution.map((entry) => entry.option);
  const coversOptions = listed.length === options.length && options.every((option) => listed.includes(option));
  const total = distribution.reduce((sum, entry) => sum + entry.probability, 0);

  const issues: Issue[] = [];
  if (!coversOptions) issues.push({ path, message: "Must list each of the question's options once" });
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) issues.push({ path, message: 'Probabilities must sum to 1' });
  return issues;
}

function answerIssues(decision: Decision, answer: Answer, index: number): Issue[] {
  const question = decision.questions.find((candidate) => candidate.id === answer.questionId);
  if (!question) return [{ path: ['answers', index, 'questionId'], message: 'Unknown question' }];

  const options = optionsOf(question);
  const choiceIssues = options.includes(answer.choice)
    ? []
    : [{ path: ['answers', index, 'choice'], message: 'Not an option of the question' }];

  const runIssues = (answer.runs ?? []).flatMap((run, runIndex) =>
    run.answer === null || options.includes(run.answer)
      ? []
      : [{ path: ['answers', index, 'runs', runIndex, 'answer'], message: 'Not an option of the question' }],
  );

  return [
    ...choiceIssues,
    ...runIssues,
    ...distributionIssues(options, answer.distribution, ['answers', index, 'distribution']),
  ];
}

function decisionIssues(decision: Decision, result: Result): Issue[] {
  if (result.status === 'failed') return [];

  const perAnswer = result.answers.flatMap((answer, index) => answerIssues(decision, answer, index));
  return [...coverageIssues(decision, result.answers, result.status === 'ok'), ...perAnswer];
}

export function parseResult(decision: Decision, raw: unknown) {
  const schema = ResultSchema.superRefine((result, context) => {
    for (const issue of decisionIssues(decision, result)) context.addIssue({ code: 'custom', ...issue });
  });
  return schema.safeParse(raw);
}
