import { describe, expect, it } from 'vitest';
import { CAPABILITIES, effectiveCapabilities, requiresServer } from '../../src/index.ts';
import { fakeModel } from '../fakes/fake-model.ts';
import { fakeTransport } from '../fakes/fake-transport.ts';

const [probabilities, reasoning, attribution] = CAPABILITIES;

describe('Golden', () => {
  it('keeps exactly the capabilities both the model and the transport declare', () => {
    const transport = fakeTransport({ capabilities: [probabilities, reasoning] });
    const model = fakeModel({ capabilities: [probabilities, attribution], transport });

    expect(effectiveCapabilities(model)).toEqual([probabilities]);
  });

  it('requires the server when the transport does', () => {
    const model = fakeModel({ transport: fakeTransport({ requiresServer: true }) });

    expect(requiresServer(model)).toBe(true);
  });

  it('does not require the server when the transport does not', () => {
    const model = fakeModel({ transport: fakeTransport({ requiresServer: false }) });

    expect(requiresServer(model)).toBe(false);
  });
});

describe('Edge', () => {
  it('drops probabilities when the transport cannot carry them', () => {
    const transport = fakeTransport({ capabilities: [reasoning] });
    const model = fakeModel({ capabilities: [probabilities, reasoning], transport });

    expect(effectiveCapabilities(model)).not.toContain(probabilities);
  });

  it('has no capabilities when the transport declares none', () => {
    const model = fakeModel({ capabilities: [...CAPABILITIES], transport: fakeTransport() });

    expect(effectiveCapabilities(model)).toEqual([]);
  });
});
