import { describe, expect, it } from 'vitest';
import { runDuration } from '../../src/format.ts';
import { costLabel, money } from '../../src/services/costs.ts';

describe('Golden', () => {
  it('states the run duration at the request limit', () => {
    expect(runDuration(60, 20)).toBe('~3 min run duration at 20 requests/min');
  });

  it('shows a cost with four decimals below a cent', () => {
    expect(money(0.0042)).toBe('$0.0042');
  });
});

describe('Edge', () => {
  it('rounds a partial minute up', () => {
    expect(runDuration(41, 20)).toBe('~3 min run duration at 20 requests/min');
  });

  it('says under a minute for short runs', () => {
    expect(runDuration(5, 20)).toBe('under 1 min run duration at 20 requests/min');
  });

  it('says there is no limit when throttling is off', () => {
    expect(runDuration(500, 0)).toBe('no request limit');
  });

  it('flags an incomplete cost total', () => {
    expect(costLabel({ usd: 0.5, complete: false })).toBe('$0.500 + variable');
  });
});
