const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const DIGEST_LENGTH = 7;

export function hash32(text: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function digest(text: string): string {
  return hash32(text).toString(16).padStart(8, '0').slice(0, DIGEST_LENGTH);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}
