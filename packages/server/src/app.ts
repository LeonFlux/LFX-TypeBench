import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  API_HEADER,
  API_HEADER_VALUE,
  HEALTH_PATH,
  type Health,
  OPEN_ROUTER_CHAT_PATH,
  type Transport,
  type TransportRequest,
  TransportRequestSchema,
} from '@typed-decisions/core';
import { Hono } from 'hono';

export type AppOptions = {
  openRouter: Transport | null;
  keyHint?: string | null;
  allowedOrigins?: string[];
  staticRoot?: string;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NO_KEY = 'The server has no OPENROUTER_KEY. Add it to .env and restart the server.';
const FORBIDDEN = 'Only this app can call the server.';
const INVALID_REQUEST = 'Invalid request';
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin || allowedOrigins.includes(origin)) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createApp({ openRouter, keyHint = null, allowedOrigins = [], staticRoot }: AppOptions): Hono {
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET') return next();
    const fromApp = c.req.header(API_HEADER) === API_HEADER_VALUE;
    if (!fromApp || !isAllowedOrigin(c.req.header('origin'), allowedOrigins))
      return c.json({ error: FORBIDDEN }, HTTP_FORBIDDEN);
    return next();
  });

  app.get(HEALTH_PATH, (c) => {
    const health: Health = {
      status: 'ok',
      keyHint: openRouter ? keyHint : null,
      features: { openRouter: openRouter !== null, history: false, cli: false, localModels: false },
    };
    return c.json(health);
  });

  app.post(OPEN_ROUTER_CHAT_PATH, async (c) => {
    if (!openRouter) return c.json({ error: NO_KEY }, HTTP_UNAVAILABLE);
    const parsed = TransportRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: INVALID_REQUEST }, HTTP_BAD_REQUEST);
    try {
      const request = parsed.data as TransportRequest;
      return c.json(await openRouter.send({ ...request, signal: c.req.raw.signal }));
    } catch (error) {
      return c.json({ error: messageOf(error) }, HTTP_BAD_GATEWAY);
    }
  });

  if (staticRoot && existsSync(staticRoot)) app.use('/*', serveStatic({ root: staticRoot }));
  return app;
}
