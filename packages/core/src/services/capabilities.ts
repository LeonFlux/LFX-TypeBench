import { CAPABILITIES, type Capability } from '../contracts/capability.ts';
import type { Model } from '../contracts/model.ts';

export function effectiveCapabilities(model: Model): Capability[] {
  return CAPABILITIES.filter(
    (capability) => model.capabilities.includes(capability) && model.transport.capabilities.includes(capability),
  );
}

export function requiresServer(model: Model): boolean {
  return model.transport.requiresServer;
}
