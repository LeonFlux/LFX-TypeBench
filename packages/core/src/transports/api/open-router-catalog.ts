import type { OpenRouterCore } from '@openrouter/sdk/core.js';
import { modelsList } from '@openrouter/sdk/funcs/modelsList.js';
import type { Model as Listing } from '@openrouter/sdk/models';
import type { Capability } from '../../contracts/capability.ts';
import type { ModelProfile } from '../../models/chat-model.ts';
import type { Pricing } from '../../services/costs.ts';
import { type Fetcher, openRouterClient } from './open-router-client.ts';

export type { Pricing } from '../../services/costs.ts';

export type CatalogEntry = {
  id: string;
  name: string;
  version: string;
  capabilities: Capability[];
  profile: ModelProfile;
  pricing: Pricing | null;
  contextLength: number | null;
};

const LOGPROBS_PARAMETERS = ['logprobs', 'top_logprobs'];
const REASONING_PARAMETER = 'reasoning';
const DISABLING_EFFORTS = ['none'];
const FALLBACK_EFFORT = 'low';

function lowestEffort(efforts: readonly (string | null)[] | null | undefined): string {
  const usable = (efforts ?? []).filter((effort): effort is string => !!effort && !DISABLING_EFFORTS.includes(effort));
  return usable.at(-1) ?? FALLBACK_EFFORT;
}

function priceOf(value: string): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function pricingOf(listing: Listing): Pricing | null {
  const inputPerToken = priceOf(listing.pricing.prompt);
  const outputPerToken = priceOf(listing.pricing.completion);
  return inputPerToken === null || outputPerToken === null ? null : { inputPerToken, outputPerToken };
}

export function entryFromListing(listing: Listing): CatalogEntry {
  const parameters: string[] = listing.supportedParameters;
  const readsLogprobs = LOGPROBS_PARAMETERS.every((parameter) => parameters.includes(parameter));
  const reasons = parameters.includes(REASONING_PARAMETER);
  const capabilities: Capability[] = [
    ...(readsLogprobs ? (['probabilities'] as const) : []),
    ...(reasons ? (['reasoning'] as const) : []),
  ];

  return {
    id: listing.id,
    name: listing.name,
    version: listing.canonicalSlug,
    capabilities,
    profile: {
      temperature: parameters.includes('temperature'),
      seed: parameters.includes('seed'),
      reasoning: reasons
        ? {
            mandatory: listing.reasoning?.mandatory ?? false,
            effort: lowestEffort(listing.reasoning?.supportedEfforts),
          }
        : null,
    },
    pricing: pricingOf(listing),
    contextLength: listing.contextLength,
  };
}

export async function loadCatalog(options: { fetcher?: Fetcher; signal?: AbortSignal } = {}): Promise<CatalogEntry[]> {
  const client: OpenRouterCore = openRouterClient(options.fetcher ? { fetcher: options.fetcher } : {});
  const outcome = await modelsList(client, {}, options.signal ? { signal: options.signal } : {});
  if (!outcome.ok) throw outcome.error;
  return outcome.value.result.data.map(entryFromListing);
}
