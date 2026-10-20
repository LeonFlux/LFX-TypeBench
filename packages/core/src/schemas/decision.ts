import { z } from 'zod';
import { MAX_INPUT_CHARS, MAX_OPTIONS, MAX_QUESTIONS, MAX_SCORE_STEPS } from '../limits.ts';
import { NonBlankSchema } from './text.ts';

const YES_NO_OPTIONS = ['yes', 'no'];

function isUnique(values: string[]) {
  return new Set(values).size === values.length;
}

function parseJsonText(value: unknown, context: z.RefinementCtx) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Must be valid JSON' });
    return z.NEVER;
  }
}

function fitsInputLimit(value: unknown) {
  return JSON.stringify(value).length <= MAX_INPUT_CHARS;
}

const TextInputSchema = z.strictObject({
  kind: z.literal('text'),
  text: NonBlankSchema.max(MAX_INPUT_CHARS),
});

const JsonInputSchema = z.strictObject({
  kind: z.literal('json'),
  json: z
    .unknown()
    .transform(parseJsonText)
    .pipe(z.json())
    .refine(fitsInputLimit, `Must not exceed ${MAX_INPUT_CHARS} characters`),
});

const questionFields = { id: NonBlankSchema, prompt: NonBlankSchema };

const ChoiceQuestionSchema = z.strictObject({
  ...questionFields,
  type: z.literal('choice'),
  options: z.array(NonBlankSchema).min(2).max(MAX_OPTIONS).refine(isUnique, 'Options must be unique'),
});

const YesNoQuestionSchema = z.strictObject({
  ...questionFields,
  type: z.literal('yes-no'),
});

const ScoreQuestionSchema = z
  .strictObject({
    ...questionFields,
    type: z.literal('score'),
    min: z.int(),
    max: z.int(),
  })
  .refine((question) => question.min < question.max, 'Min must be below max')
  .refine((question) => question.max - question.min + 1 <= MAX_SCORE_STEPS, `Must not exceed ${MAX_SCORE_STEPS} steps`);

export const QuestionSchema = z.discriminatedUnion('type', [
  ChoiceQuestionSchema,
  YesNoQuestionSchema,
  ScoreQuestionSchema,
]);

export const InputSchema = z.discriminatedUnion('kind', [TextInputSchema, JsonInputSchema]);

export const DecisionSchema = z.strictObject({
  input: InputSchema,
  questions: z
    .array(QuestionSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .refine((questions) => isUnique(questions.map((question) => question.id)), 'Question ids must be unique'),
});

export type Question = z.infer<typeof QuestionSchema>;
export type Decision = z.infer<typeof DecisionSchema>;

function scoreOptions(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, step) => String(min + step));
}

export function optionsOf(question: Question): string[] {
  switch (question.type) {
    case 'choice':
      return question.options;
    case 'yes-no':
      return [...YES_NO_OPTIONS];
    case 'score':
      return scoreOptions(question.min, question.max);
  }
}
