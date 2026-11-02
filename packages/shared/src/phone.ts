// Phone numbers (docs/DEVELOPMENT.md §7.11, ADR-016). Used by the API when it saves and searches
// customers, and by the web forms to warn about a number that cannot be read.
//
// Rules:
// - Keep what the seller typed (trimmed) as the display copy.
// - Normalise with libphonenumber-js, default country Sri Lanka (LK), to E.164: +94771234567.
// - A number that cannot be read is still saved, with normalized = null and a warning. Never block.
// - Search also matches the last 9 digits, so 0771234567, +94 77 123 4567 and 771234567 all match.
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export const DEFAULT_PHONE_COUNTRY = 'LK';

/** Longest text accepted as a phone (database and form limit). Longer input is never parsed. */
export const PHONE_MAX_LENGTH = 30;

/** Warning code returned when a phone was saved without a normalised form. */
export const PHONE_UNREADABLE = 'PHONE_UNREADABLE';

/** Digits used by the "last 9 digits" search (a Sri Lankan number without its 0 or +94). */
export const PHONE_SEARCH_DIGITS = 9;

export interface NormalizedPhone {
  /** What the seller typed, trimmed. Shown back to them unchanged. */
  display: string;
  /** E.164 (+94771234567), or null when the number could not be read. */
  normalized: string | null;
  /** PHONE_UNREADABLE when normalized is null; the number is still saved. */
  warning: typeof PHONE_UNREADABLE | null;
}

/**
 * Normalises a phone number typed by a seller. Returns null for empty input (no phone).
 * Accepts 0771234567, 771234567, +94 77 123 4567, 0094771234567, with spaces, dashes, dots or
 * brackets, and numbers from other countries when written with + and their country code.
 */
export function normalizePhone(input: string | null | undefined): NormalizedPhone | null {
  const display = (input ?? '').trim();
  if (display === '') return null;

  const parsed =
    display.length <= PHONE_MAX_LENGTH
      ? parsePhoneNumberFromString(display, DEFAULT_PHONE_COUNTRY)
      : undefined;
  if (parsed?.isValid()) {
    return { display, normalized: parsed.number, warning: null };
  }
  return { display, normalized: null, warning: PHONE_UNREADABLE };
}

/**
 * The last 9 digits of whatever was typed into a search box, or null when there are fewer than 9
 * (too short to search by number). Matches stored numbers however they were written (§7.11).
 */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, '');
  return digits.length >= PHONE_SEARCH_DIGITS ? digits.slice(-PHONE_SEARCH_DIGITS) : null;
}
