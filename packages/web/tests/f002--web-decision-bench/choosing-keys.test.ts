import type { Health } from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import { canCall, usesServerKey } from '../../src/views/models.ts';

function health(openRouter: boolean): Health {
  return {
    status: 'ok',
    keyHint: openRouter ? 'sk-or-...abcdef' : null,
    features: { openRouter, history: false, cli: false, localModels: false },
  };
}

function state(apiKey: string, server: Health | null) {
  return { apiKey, server } as Parameters<typeof usesServerKey>[0];
}

describe('Golden', () => {
  it('uses the server key when the browser has none', () => {
    expect(usesServerKey(state('', health(true)))).toBe(true);
  });

  it('lets a browser key override the server key', () => {
    expect(usesServerKey(state('sk-or-browser', health(true)))).toBe(false);
  });
});

describe('Edge', () => {
  it('cannot call when the server has no key and the browser has none', () => {
    expect(canCall(state('', health(false)))).toBe(false);
  });

  it('does not use a server that reports no key', () => {
    expect(usesServerKey(state('', health(false)))).toBe(false);
  });
});
