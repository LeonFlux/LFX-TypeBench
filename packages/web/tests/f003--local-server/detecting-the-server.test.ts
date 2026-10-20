import type { Health } from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import { healthCheck } from '../../src/services/server-status.ts';

const FRESH_MS = 5000;
const health: Health = {
  status: 'ok',
  keyHint: null,
  features: { openRouter: false, history: false, cli: false, localModels: false },
};

function counting() {
  let calls = 0;
  let time = 0;
  const check = healthCheck(
    async () => {
      calls++;
      return health;
    },
    () => time,
    FRESH_MS,
  );
  const advance = (ms: number) => {
    time += ms;
  };
  return { check, calls: () => calls, advance };
}

describe('Golden', () => {
  it('shares one request between checks made at the same moment', async () => {
    const probe = counting();

    await Promise.all([probe.check(), probe.check()]);

    expect(probe.calls()).toBe(1);
  });

  it('reuses a recent answer', async () => {
    const probe = counting();
    await probe.check();
    probe.advance(FRESH_MS - 1);

    await probe.check();

    expect(probe.calls()).toBe(1);
  });
});

describe('Edge', () => {
  it('asks again once the answer is stale', async () => {
    const probe = counting();
    await probe.check();
    probe.advance(FRESH_MS);

    await probe.check();

    expect(probe.calls()).toBe(2);
  });
});
