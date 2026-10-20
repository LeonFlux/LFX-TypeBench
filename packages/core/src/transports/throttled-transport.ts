import type { Capability } from '../contracts/capability.ts';
import type { Transport, TransportReply, TransportRequest } from '../contracts/transport.ts';

const MINUTE_MS = 60_000;
const ABORT_ERROR = 'AbortError';

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The run was cancelled', ABORT_ERROR));
      },
      { once: true },
    );
  });
}

export class ThrottledTransport implements Transport {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly requiresServer: boolean;
  private readonly inner: Transport;
  private readonly spacingMs: number;
  private nextStart = 0;

  constructor(inner: Transport, requestsPerMinute: number) {
    this.inner = inner;
    this.id = inner.id;
    this.capabilities = inner.capabilities;
    this.requiresServer = inner.requiresServer;
    this.spacingMs = requestsPerMinute > 0 ? MINUTE_MS / requestsPerMinute : 0;
  }

  async send(request: TransportRequest): Promise<TransportReply> {
    const now = Date.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.spacingMs;
    await wait(start - now, request.signal);
    return this.inner.send(request);
  }
}
