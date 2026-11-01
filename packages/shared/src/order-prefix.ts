// Order prefixes and order numbers (docs/DEVELOPMENT.md §7.12, ADR-010).
// Used by the API (onboarding, order creation) and the web app (live preview such as NIM-0042).

/** 2–6 uppercase letters or digits. Mirrors the businesses_prefix_chk database constraint. */
export const ORDER_PREFIX_PATTERN = /^[A-Z0-9]{2,6}$/;

/** Used when nothing sensible can be suggested from the business name. */
export const DEFAULT_ORDER_PREFIX = 'ORD';

/** Words that say nothing about the business, skipped when suggesting a prefix. */
const FILLER_WORDS = new Set([
  'THE',
  'AND',
  'OF',
  'PVT',
  'PRIVATE',
  'LTD',
  'LIMITED',
  'CO',
  'COMPANY',
]);

/**
 * Suggests an order prefix from a business name (§7.12): the first three letters of the first
 * meaningful word ("Nimali Fashions" → NIM), or the initials when the first word is short
 * ("K & S Traders" → KST). Names without Latin letters or digits (e.g. Sinhala or Tamil script)
 * get the default ORD; the seller can always type their own prefix.
 */
export function suggestOrderPrefix(businessName: string): string {
  const words = businessName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "Café" → "Cafe"
    .replace(/['’]/g, '') // "Nimali's" → "Nimalis"
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word !== '' && !FILLER_WORDS.has(word));

  const first = words[0];
  if (first === undefined) return DEFAULT_ORDER_PREFIX;
  const suggestion =
    first.length >= 3
      ? first.slice(0, 3)
      : words
          .map((word) => word[0] ?? '')
          .join('')
          .slice(0, 3);
  return ORDER_PREFIX_PATTERN.test(suggestion) ? suggestion : DEFAULT_ORDER_PREFIX;
}

/** Formats an order number: prefix, a dash, and the sequence padded to at least 4 digits (NIM-0042, NIM-12345). */
export function formatOrderNumber(prefix: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('An order sequence number must be a whole number from 1.');
  }
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}
