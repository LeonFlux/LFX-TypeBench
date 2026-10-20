import { type Capability, OpenRouterTransport, type Transport } from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, type ModelEntry, probabilitySource } from '../../src/services/registry.ts';

function entry(capabilities: Capability[]): ModelEntry {
  return {
    id: 'vendor/model',
    label: 'Model',
    version: 'vendor/model-20261001',
    capabilities,
    profile: { temperature: true, seed: true, reasoning: { mandatory: false, effort: 'low' } },
    pricing: null,
    contextLength: null,
  };
}

function transport(capabilities: Capability[]): Transport {
  return { id: 'fake', capabilities, requiresServer: false, send: () => Promise.reject(new Error('unused')) };
}

describe('insight capabilities', () => {
  it('keeps only what both the model and its transport declare', () => {
    const model = entry(['probabilities', 'reasoning', 'attribution']);

    expect(capabilitiesOf(model, transport(['probabilities', 'attribution']))).toEqual([
      'probabilities',
      'attribution',
    ]);
  });

  it('estimates probabilities when the transport cannot read logprobs', () => {
    const model = entry(['probabilities']);
    const capabilities = capabilitiesOf(model, transport(['reasoning']));

    expect(probabilitySource({ ...model, capabilities })).toBe('sampled');
  });

  it('offers no word influence through OpenRouter, even for a model that claims it', () => {
    const model = entry(['probabilities', 'attribution']);

    expect(capabilitiesOf(model, new OpenRouterTransport({ apiKey: 'unused' }))).not.toContain('attribution');
  });
});
