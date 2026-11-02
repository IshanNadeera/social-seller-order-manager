import { describe, expect, it } from 'vitest';
import { PHONE_UNREADABLE, normalizePhone, phoneSearchDigits } from './phone.js';

// Fake numbers only (no real customers' data).
const E164 = '+94771234567';

describe('normalizePhone (§7.11, ADR-016)', () => {
  it.each([
    ['0771234567', 'local with the leading 0'],
    ['771234567', 'without the leading 0'],
    ['+94 77 123 4567', 'international with spaces'],
    ['+94771234567', 'already E.164'],
    ['0094771234567', 'international with the 00 prefix'],
    ['94771234567', 'country code without +'],
    ['+94 0771234567', '+94 followed by the local 0'],
    ['077-123-4567', 'dashes'],
    ['077 123 4567', 'spaces'],
    ['+94-77-123-4567', 'international with dashes'],
    ['(077) 123-4567', 'brackets'],
    ['077.123.4567', 'dots'],
  ])('reads %s (%s) as +94771234567', (typed) => {
    expect(normalizePhone(typed)).toEqual({ display: typed, normalized: E164, warning: null });
  });

  it('keeps the typed copy exactly, apart from surrounding spaces', () => {
    expect(normalizePhone('  077 1234567  ')).toEqual({
      display: '077 1234567',
      normalized: E164,
      warning: null,
    });
  });

  it('reads Sri Lankan landlines', () => {
    expect(normalizePhone('011 234 5678')?.normalized).toBe('+94112345678');
  });

  it('reads numbers from other countries written with + and their country code', () => {
    expect(normalizePhone('+44 20 7946 0958')?.normalized).toBe('+442079460958');
  });

  it.each(['12345', 'abc', '077123', '07712345678901', '+94 77 123 4567 8', '0'.repeat(40)])(
    'keeps %s with normalized = null and a warning, instead of refusing it',
    (typed) => {
      expect(normalizePhone(typed)).toEqual({
        display: typed,
        normalized: null,
        warning: PHONE_UNREADABLE,
      });
    },
  );

  it.each(['', '   ', null, undefined])('treats %j as "no phone"', (typed) => {
    expect(normalizePhone(typed)).toBeNull();
  });
});

describe('phoneSearchDigits (last 9 digits, §7.11)', () => {
  it.each([
    ['+94 77 123 4567', '771234567'],
    ['0771234567', '771234567'],
    ['771234567', '771234567'],
    ['0094-77-123-4567', '771234567'],
  ])('%s → %s', (query, digits) => {
    expect(phoneSearchDigits(query)).toBe(digits);
  });

  it('finds the same digits for every way of writing one number', () => {
    const forms = ['0771234567', '771234567', '+94 77 123 4567', '0094771234567', '077-123-4567'];
    expect(new Set(forms.map(phoneSearchDigits))).toEqual(new Set(['771234567']));
  });

  it('returns null when there are too few digits to search by number', () => {
    expect(phoneSearchDigits('4567')).toBeNull();
    expect(phoneSearchDigits('Nimali')).toBeNull();
  });
});
