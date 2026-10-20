import type { Capability, Transport, TransportReply, TransportRequest } from '../../src/index.ts';

type FakeTransportOptions = { capabilities?: Capability[]; requiresServer?: boolean };

export function fakeTransport(options: FakeTransportOptions = {}): Transport {
  return {
    id: 'fake-transport',
    capabilities: options.capabilities ?? [],
    requiresServer: options.requiresServer ?? false,
    async send(request: TransportRequest): Promise<TransportReply> {
      return { text: request.messages.at(-1)?.content ?? '', latencyMs: 5, costUsd: 0 };
    },
  };
}
