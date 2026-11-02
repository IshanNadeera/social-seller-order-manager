// A request's fingerprint for idempotency (docs/DEVELOPMENT.md §9.8): the same JSON in any key order
// gives the same hash, so a retried request matches its first attempt.
import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level; undefined properties are left out, as JSON does. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 of the endpoint and the canonical payload. */
export function requestHash(endpoint: string, payload: unknown): string {
  return createHash('sha256').update(`${endpoint}\n${canonicalJson(payload)}`).digest('hex');
}
