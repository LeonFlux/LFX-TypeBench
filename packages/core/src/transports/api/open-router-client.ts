import { OpenRouterCore } from '@openrouter/sdk/core.js';
import { HTTPClient } from '@openrouter/sdk/lib/http.js';

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OpenRouterClientOptions = { apiKey?: string; fetcher?: Fetcher; appTitle?: string };

export const APP_TITLE = 'Typed Decisions';

export function openRouterClient({ apiKey, fetcher, appTitle = APP_TITLE }: OpenRouterClientOptions): OpenRouterCore {
  return new OpenRouterCore({
    appTitle,
    ...(apiKey ? { apiKey } : {}),
    ...(fetcher ? { httpClient: new HTTPClient({ fetcher }) } : {}),
  });
}
