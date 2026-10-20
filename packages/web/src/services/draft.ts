import { type Decision, DecisionSchema, MAX_SCORE_STEPS, type Question } from '@typed-decisions/core';

export type QuestionType = Question['type'];
export type InputFormat = 'text' | 'json';

export type DraftQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  min: number;
  max: number;
};

export type Draft = {
  key: string;
  name: string;
  id: string;
  version: number;
  input: { format: InputFormat; value: string };
  questions: DraftQuestion[];
};

export type DraftError = { code: string; path: string };

type Issue = { code: string; path: PropertyKey[]; message: string };

export type CheckedDraft = { decision: Decision | null; errors: DraftError[] };

const SLUG = /^[a-z][a-z0-9_-]{0,47}$/;
const DEFAULT_SCORE = { min: 1, max: 5 };
const QUESTION_PREFIX = 'q';
const FALLBACK_CODE = 'invalid';
const JSON_BODY_KEY = 'body';
const JSON_INDENT = 2;

export { MAX_SCORE_STEPS };

export function newQuestion(type: QuestionType, takenIds: string[]): DraftQuestion {
  let n = takenIds.length + 1;
  while (takenIds.includes(`${QUESTION_PREFIX}${n}`)) n++;
  return { id: `${QUESTION_PREFIX}${n}`, type, prompt: '', options: [], ...DEFAULT_SCORE };
}

function rawQuestion(question: DraftQuestion) {
  const base = { id: question.id, type: question.type, prompt: question.prompt };
  if (question.type === 'choice') return { ...base, options: question.options };
  if (question.type === 'score') return { ...base, min: question.min, max: question.max };
  return base;
}

export function rawDecision(draft: Draft) {
  const input =
    draft.input.format === 'text'
      ? { kind: 'text', text: draft.input.value }
      : { kind: 'json', json: draft.input.value };
  return { input, questions: draft.questions.map(rawQuestion) };
}

function pathLabel(path: PropertyKey[]): string {
  return path
    .map((part, index) => (typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`))
    .join('');
}

function inputCode(field: PropertyKey | undefined, issue: Issue): string {
  if (issue.code === 'too_big' || issue.message.includes('exceed')) return 'input-too-large';
  return field === 'json' ? 'input-json-invalid' : 'input-required';
}

function questionsCode(issue: Issue): string {
  if (issue.code === 'too_small') return 'no-questions';
  if (issue.code === 'too_big') return 'too-many-questions';
  return 'question-id-duplicate';
}

const OPTION_PATH_LENGTH = 4;

function optionsCode(issue: Issue, depth: number): string {
  if (depth >= OPTION_PATH_LENGTH) return 'option-blank';
  if (issue.code === 'too_small') return 'choice-min-options';
  if (issue.code === 'too_big') return 'too-many-options';
  return 'choice-duplicate-options';
}

const QUESTION_FIELD_CODES: Record<string, string> = {
  id: 'question-id-required',
  prompt: 'prompt-required',
  type: 'type-unknown',
  min: 'score-range-invalid',
  max: 'score-range-invalid',
};

export function codeOf(issue: Issue): string {
  const [root, index, field] = issue.path;
  if (root === 'input') return inputCode(index, issue);
  if (root !== 'questions') return FALLBACK_CODE;
  if (index === undefined) return questionsCode(issue);
  if (field === undefined) return 'score-range-invalid';
  if (field === 'options') return optionsCode(issue, issue.path.length);
  return QUESTION_FIELD_CODES[String(field)] ?? FALLBACK_CODE;
}

function metadataErrors(draft: Draft): DraftError[] {
  const errors: DraftError[] = [];
  if (!draft.name.trim()) errors.push({ code: 'name-required', path: 'name' });
  if (!SLUG.test(draft.id)) errors.push({ code: 'id-invalid', path: 'id' });
  return errors;
}

export function checkDraft(draft: Draft): CheckedDraft {
  const parsed = DecisionSchema.safeParse(rawDecision(draft));
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ code: codeOf(issue), path: pathLabel(issue.path) }));
  const errors = [...metadataErrors(draft), ...schemaErrors];
  return { decision: parsed.success && errors.length === 0 ? parsed.data : null, errors };
}

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isBodyOnly(value: unknown): value is { [JSON_BODY_KEY]: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === JSON_BODY_KEY &&
    typeof (value as Record<string, unknown>)[JSON_BODY_KEY] === 'string'
  );
}

function isStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

export function formatJson(value: string): string {
  const parsed = parsedJson(value);
  return parsed === undefined ? value : JSON.stringify(parsed, null, JSON_INDENT);
}

export function switchFormat(input: Draft['input'], to: InputFormat): Draft['input'] {
  if (input.format === to) return input;
  const parsed = parsedJson(input.value);
  if (to === 'text') return { format: 'text', value: isBodyOnly(parsed) ? parsed[JSON_BODY_KEY] : input.value };
  if (isStructured(parsed)) return { format: 'json', value: JSON.stringify(parsed, null, JSON_INDENT) };
  return { format: 'json', value: JSON.stringify({ [JSON_BODY_KEY]: input.value }, null, JSON_INDENT) };
}
