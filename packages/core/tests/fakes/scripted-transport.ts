import type { Capability, Transport, TransportReply, TransportRequest } from '../../src/index.ts';

type Script = (request: TransportRequest, index: number) => TransportReply | Promise<TransportReply>;
type ScriptedTransportOptions = { capabilities?: Capability[]; requiresServer?: boolean };

export type ScriptedTransport = Transport & { requests: TransportRequest[] };

export function scriptedTransport(script: Script, options: ScriptedTransportOptions = {}): ScriptedTransport {
  const requests: TransportRequest[] = [];
  return {
    id: 'scripted',
    capabilities: options.capabilities ?? ['probabilities', 'reasoning'],
    requiresServer: options.requiresServer ?? false,
    requests,
    async send(request) {
      requests.push(request);
      return script(request, requests.length - 1);
    },
  };
}

export function textReply(text: string, extra: Partial<TransportReply> = {}): TransportReply {
  return { text, latencyMs: 10, costUsd: 0.001, usage: { inputTokens: 100, outputTokens: 2 }, ...extra };
}

export function logprobsReply(top: Record<string, number>, extra: Partial<TransportReply> = {}): TransportReply {
  const entries = Object.entries(top).map(([token, probability]) => ({ token, logprob: Math.log(probability) }));
  const [first] = entries;
  return textReply(first?.token ?? '', {
    logprobs: [{ token: first?.token ?? '', logprob: first?.logprob ?? 0, top: entries }],
    ...extra,
  });
}
