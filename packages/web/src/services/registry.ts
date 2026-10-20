import {
  type Capability,
  type CatalogEntry,
  ChatModel,
  effectiveCapabilities,
  type ModelProfile,
  type Pricing,
  type RunSettings,
  type Transport,
} from '@typed-decisions/core';

export type ModelEntry = {
  id: string;
  label: string;
  version: string;
  capabilities: Capability[];
  profile: ModelProfile;
  pricing: Pricing | null;
  contextLength: number | null;
};

export type ProbabilitySource = 'logprobs' | 'sampled';

export type AddOutcome = { ids: string[] } | { error: 'unknown' | 'duplicate' | 'offline' };

export function entryFromCatalog(listing: CatalogEntry): ModelEntry {
  const { name, ...rest } = listing;
  return { ...rest, label: name };
}

export function resolveModels(ids: string[], catalog: CatalogEntry[] | null): ModelEntry[] {
  return ids
    .map((id) => catalog?.find((listing) => listing.id === id))
    .filter((listing): listing is CatalogEntry => listing !== undefined)
    .map(entryFromCatalog);
}

export function addModel(ids: string[], id: string, catalog: CatalogEntry[] | null): AddOutcome {
  if (ids.includes(id)) return { error: 'duplicate' };
  if (!catalog) return { error: 'offline' };
  if (!catalog.some((listing) => listing.id === id)) return { error: 'unknown' };
  return { ids: [...ids, id] };
}

export function removeModel(ids: string[], id: string): string[] {
  return ids.filter((candidate) => candidate !== id);
}

export function probabilitySource(entry: ModelEntry): ProbabilitySource {
  const readsLogprobs = entry.capabilities.includes('probabilities') && !entry.profile.reasoning?.mandatory;
  return readsLogprobs ? 'logprobs' : 'sampled';
}

export function buildModel(entry: ModelEntry, transport: Transport): ChatModel {
  const { id, version, capabilities, profile, pricing } = entry;
  return new ChatModel({ id, version, capabilities, profile, pricing, transport });
}

export function capabilitiesOf(entry: ModelEntry, transport: Transport): Capability[] {
  return effectiveCapabilities(buildModel(entry, transport));
}

export function isFreeListing(entry: Pick<CatalogEntry, 'pricing'>): boolean {
  return entry.pricing?.inputPerToken === 0 && entry.pricing.outputPerToken === 0;
}

export function isFree(entry: ModelEntry): boolean {
  return entry.pricing?.inputPerToken === 0 && entry.pricing.outputPerToken === 0;
}

export function reasons(entry: ModelEntry, settings: RunSettings): boolean {
  return !!entry.profile.reasoning && (settings.reasoning || entry.profile.reasoning.mandatory);
}
