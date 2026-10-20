import type { Capability } from '../../contracts/capability.ts';
import {
  API_HEADER,
  API_HEADER_VALUE,
  ApiErrorSchema,
  HEALTH_PATH,
  type Health,
  HealthSchema,
  OPEN_ROUTER_CHAT_PATH,
  TransportReplySchema,
} from '../../contracts/server-api.ts';
import type { Transport, TransportReply, TransportRequest } from '../../contracts/transport.ts';
import type { Fetcher } from '../api/open-router-client.ts';
import { OPEN_ROUTER_ID } from '../api/open-router-transport.ts';

type ServerOptions = { baseUrl?: string; fetcher?: Fetcher };

const CAPABILITIES: Capability[] = ['probabilities', 'reasoning'];
const HEALTH_TIMEOUT_MS = 1500;
const INVALID_REPLY = 'The server returned an invalid reply';

function defaultFetcher(): Fetcher {
  return (input, init) => fetch(input, init);
}

async function errorOf(response: Response): Promise<Error> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.error : `Server ${response.status}`);
}

export async function fetchHealth({
  baseUrl = '',
  fetcher = defaultFetcher(),
}: ServerOptions = {}): Promise<Health | null> {
  try {
    const response = await fetcher(`${baseUrl}${HEALTH_PATH}`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const parsed = HealthSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class ServerTransport implements Transport {
  readonly id = OPEN_ROUTER_ID;
  readonly capabilities = CAPABILITIES;
  readonly requiresServer = true;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor({ baseUrl = '', fetcher = defaultFetcher() }: ServerOptions = {}) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async send(request: TransportRequest): Promise<TransportReply> {
    const { signal, ...body } = request;
    const response = await this.fetcher(`${this.baseUrl}${OPEN_ROUTER_CHAT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [API_HEADER]: API_HEADER_VALUE },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await errorOf(response);

    const parsed = TransportReplySchema.safeParse(await response.json());
    if (!parsed.success) throw new Error(INVALID_REPLY);
    return parsed.data as TransportReply;
  }
}
