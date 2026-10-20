import type { Decision } from '../schemas/decision.ts';

export type Input = Decision['input'];

export type Segment = { id: string; text: string };

const SENTENCE_BREAK = /(?<=[.!?])\s+/;
const GREETING = /^(Hi|Hello|Hey|Dear)\b[^—,-]*[—,-]\s*/i;
const KEY_PREFIX = 'key:';
const SENTENCE_PREFIX = 's';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitGreeting(sentence: string): string[] {
  const greeting = sentence.match(GREETING)?.[0];
  return greeting ? [greeting, sentence.slice(greeting.length)] : [sentence];
}

function textSegments(text: string): Segment[] {
  return text
    .split(SENTENCE_BREAK)
    .flatMap(splitGreeting)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({ id: `${SENTENCE_PREFIX}${index + 1}`, text: part }));
}

type Located = Segment & { key: string | null; sentence: number | null };

function locateJson(json: Record<string, unknown>): Located[] {
  let count = 0;
  return Object.entries(json).flatMap(([key, value]): Located[] => {
    if (typeof value !== 'string') {
      return [{ id: `${KEY_PREFIX}${key}`, text: `${key}: ${JSON.stringify(value)}`, key, sentence: null }];
    }
    return textSegments(value).map((part, sentence) => ({
      id: `${SENTENCE_PREFIX}${++count}`,
      text: part.text,
      key,
      sentence,
    }));
  });
}

function locate(input: Input): Located[] {
  if (input.kind === 'text')
    return textSegments(input.text).map((part, sentence) => ({ ...part, key: null, sentence }));
  return isRecord(input.json) ? locateJson(input.json) : [];
}

function joinedWithout(text: string, removed: number): string {
  return textSegments(text)
    .filter((_, index) => index !== removed)
    .map((part) => part.text)
    .join(' ');
}

export function segmentInput(input: Input): Segment[] {
  return locate(input).map(({ id, text }) => ({ id, text }));
}

export function withoutSegment(input: Input, segment: Segment): Input {
  const target = locate(input).find((candidate) => candidate.id === segment.id);
  if (!target) return input;
  if (input.kind === 'text') return { kind: 'text', text: joinedWithout(input.text, target.sentence ?? -1) };
  if (!isRecord(input.json) || target.key === null) return input;

  const { key, sentence } = target;
  const value = input.json[key];
  const remaining = sentence === null || typeof value !== 'string' ? '' : joinedWithout(value, sentence);
  const entries = Object.entries(input.json).flatMap(([candidate, kept]) => {
    if (candidate !== key) return [[candidate, kept]];
    return remaining ? [[candidate, remaining]] : [];
  });
  return { kind: 'json', json: Object.fromEntries(entries) };
}
