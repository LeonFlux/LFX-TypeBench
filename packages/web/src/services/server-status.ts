import type { Health } from '@typed-decisions/core';

type Probe = () => Promise<Health | null>;

export function healthCheck(probe: Probe, now: () => number, freshMs: number): () => Promise<Health | null> {
  let pending: Promise<Health | null> | null = null;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let last: Health | null = null;

  return () => {
    if (pending) return pending;
    if (now() - checkedAt < freshMs) return Promise.resolve(last);
    pending = probe().then((health) => {
      last = health;
      checkedAt = now();
      pending = null;
      return health;
    });
    return pending;
  };
}
