const SECOND_MS = 1000;
const NOISE = 0.0005;

export const pct = (probability: number, digits = 0) => `${(probability * 100).toFixed(digits)}%`;

export const duration = (ms: number) => (ms < SECOND_MS ? `${Math.round(ms)} ms` : `${(ms / SECOND_MS).toFixed(2)} s`);

export const int = (n: number) => Math.round(n).toLocaleString('en-US');

export const signed = (delta: number) => {
  const sign = delta > NOISE ? '+' : delta < -NOISE ? '−' : '±';
  return `${sign}${Math.abs(delta).toFixed(2)}`;
};

export function runDuration(calls: number, requestsPerMinute: number): string {
  if (!requestsPerMinute) return 'no request limit';
  const minutes = calls / requestsPerMinute;
  const span = minutes < 1 ? 'under 1 min' : `~${Math.ceil(minutes)} min`;
  return `${span} run duration at ${requestsPerMinute} requests/min`;
}
