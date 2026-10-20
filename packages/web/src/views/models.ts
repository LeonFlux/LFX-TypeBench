import {
  type ChatModel,
  OpenRouterTransport,
  ServerTransport,
  ThrottledTransport,
  type Transport,
} from '@typed-decisions/core';
import { checkDraft } from '../services/draft.ts';
import { buildModel, capabilitiesOf, type ModelEntry, probabilitySource } from '../services/registry.ts';
import type { Ctx, RunModel, State } from '../state.ts';

const PLANNING_KEY = 'planning-only';

export function enabledEntries(ctx: Ctx) {
  return ctx.state.entries.filter((entry) => ctx.state.enabled.has(entry.id));
}

export function enabledModels(ctx: Ctx): ChatModel[] {
  const transport = new OpenRouterTransport({ apiKey: ctx.state.apiKey || PLANNING_KEY });
  return enabledEntries(ctx).map((entry) => buildModel(entry, transport));
}

export function runModels(ctx: Ctx): RunModel[] {
  return enabledEntries(ctx).map((entry) => {
    const capabilities = entryCapabilities(ctx.state, entry);
    return {
      id: entry.id,
      label: entry.label,
      source: probabilitySource({ ...entry, capabilities }),
      reasons: capabilities.includes('reasoning'),
      attribution: capabilities.includes('attribution'),
    };
  });
}

export function canRun(ctx: Ctx): boolean {
  const { state } = ctx;
  return !!checkDraft(state.draft).decision && enabledEntries(ctx).length > 0 && canCall(state) && !state.running;
}

export function usesServerKey(state: Pick<State, 'server' | 'apiKey'>): boolean {
  return (state.server?.features.openRouter ?? false) && state.apiKey === '';
}

export function canCall(state: Pick<State, 'server' | 'apiKey'>): boolean {
  return usesServerKey(state) || state.apiKey !== '';
}

function directTransport(state: Pick<State, 'server' | 'apiKey'>): Transport {
  return usesServerKey(state) ? new ServerTransport() : new OpenRouterTransport({ apiKey: state.apiKey });
}

export function entryCapabilities(state: Pick<State, 'server' | 'apiKey'>, entry: ModelEntry) {
  return capabilitiesOf(entry, directTransport(state));
}

export function callTransport(state: State): Transport {
  return new ThrottledTransport(directTransport(state), state.requestsPerMinute);
}
