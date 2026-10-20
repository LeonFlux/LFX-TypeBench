import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { maskKey, OpenRouterTransport } from '@typed-decisions/core';
import { createApp } from './app.ts';

const DEFAULT_PORT = 8787;
const HOST = '127.0.0.1';
const STATIC_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

const apiKey = process.env.OPENROUTER_KEY?.trim() ?? '';
const port = Number(process.env.PORT) || DEFAULT_PORT;
const openRouter = apiKey ? new OpenRouterTransport({ apiKey }) : null;

const keyHint = apiKey ? maskKey(apiKey) : null;
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
const codespaceOrigin =
  CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `https://${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : null;
const allowedOrigins = codespaceOrigin ? [codespaceOrigin] : [];

serve(
  { fetch: createApp({ openRouter, keyHint, allowedOrigins, staticRoot: STATIC_ROOT }).fetch, port, hostname: HOST },
  (info) => {
    const keyState = openRouter ? 'OpenRouter key loaded' : 'no OPENROUTER_KEY, calls disabled';
    console.log(`Typed Decisions server on http://${HOST}:${info.port} (${keyState})`);
    if (codespaceOrigin) console.log(`Codespaces: forward port ${info.port}, then open ${codespaceOrigin}`);
  },
);
