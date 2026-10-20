import type { RunSettings } from '@typed-decisions/core';
import { z } from 'zod';
import { newKey } from './decisions.ts';
import type { Draft } from './draft.ts';

export type SessionConfig = {
  drafts: Draft[];
  activeKey: string;
  models: string[];
  enabled: string[];
  settings: RunSettings;
  requestsPerMinute: number;
};

const API_KEY_STORAGE = 'decisionBench.apiKey';
const CONFIG_STORAGE = 'decisionBench.config';

const DraftSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  id: z.string(),
  version: z.int().positive(),
  input: z.object({ format: z.enum(['text', 'json']), value: z.string() }),
  questions: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['choice', 'yes-no', 'score']),
      prompt: z.string(),
      options: z.array(z.string()),
      min: z.number(),
      max: z.number(),
    }),
  ),
});

const ConfigSchema = z.object({
  drafts: z.array(DraftSchema).min(1),
  activeKey: z.string(),
  models: z.array(z.string()).default([]),
  enabled: z.array(z.string()),
  requestsPerMinute: z.int().nonnegative(),
  settings: z.object({
    samples: z.int().positive(),
    seed: z.int(),
    reasoning: z.boolean(),
    concurrency: z.int().positive(),
  }),
});

type Area = 'local' | 'session';

function storage(area: Area): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function localArea(): Storage | null {
  return storage('local');
}

function read(area: Area, key: string): string | null {
  try {
    return storage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(area: Area, key: string, value: string | null) {
  try {
    if (value === null) storage(area)?.removeItem(key);
    else storage(area)?.setItem(key, value);
  } catch {
    /* storage unavailable or full: settings simply aren't remembered */
  }
}

export function readApiKey(): string {
  return read('session', API_KEY_STORAGE) ?? '';
}

export function writeApiKey(key: string) {
  write('session', API_KEY_STORAGE, key.trim() === '' ? null : key.trim());
}

function withDraftList(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('draft' in raw) || 'drafts' in raw) return raw;
  const { draft, ...rest } = raw as { draft: Record<string, unknown> };
  const key = newKey();
  return { ...rest, drafts: [{ ...draft, key }], activeKey: key };
}

export function readConfig(): SessionConfig | null {
  const raw = read('local', CONFIG_STORAGE);
  if (!raw) return null;
  try {
    const parsed = ConfigSchema.safeParse(withDraftList(JSON.parse(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeConfig(config: SessionConfig) {
  write('local', CONFIG_STORAGE, JSON.stringify(config));
}
