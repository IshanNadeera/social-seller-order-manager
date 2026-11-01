import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_PREFIX,
  ORDER_PREFIX_PATTERN,
  formatOrderNumber,
  suggestOrderPrefix,
} from './index.js';

describe('suggestOrderPrefix', () => {
  it.each([
    ['Nimali Fashions', 'NIM'],
    ["Nimali's Boutique", 'NIM'],
    ['  nimali   fashions  ', 'NIM'],
    ['K & S Traders', 'KST'],
    ['A B', 'AB'],
    ['The Gift Box', 'GIF'],
    ['Café Lanka', 'CAF'],
    ['ABC Pvt Ltd', 'ABC'],
    ['7 Seas Exports', '7SE'],
    ['24x7 Mart', '24X'],
  ])('suggests a prefix from %j → %s', (name, expected) => {
    expect(suggestOrderPrefix(name)).toBe(expected);
  });

  it.each(['', '   ', '!!!', 'නිමාලි ෆැෂන්', 'நிமாலி', 'X', 'The', 'Pvt Ltd'])(
    'falls back to ORD for %j',
    (name) => {
      expect(suggestOrderPrefix(name)).toBe(DEFAULT_ORDER_PREFIX);
    },
  );

  it('always returns a valid prefix', () => {
    const names = ['Nimali Fashions', 'K & S Traders', '', 'a', '12', 'Ünïcödé Störe', '🙂 Shop'];
    for (const name of names) expect(suggestOrderPrefix(name)).toMatch(ORDER_PREFIX_PATTERN);
  });
});

describe('formatOrderNumber', () => {
  it.each([
    ['NIM', 1, 'NIM-0001'],
    ['NIM', 42, 'NIM-0042'],
    ['ORD', 9999, 'ORD-9999'],
    ['ORD', 12345, 'ORD-12345'],
  ])('formats %s + %i as %s', (prefix, sequence, expected) => {
    expect(formatOrderNumber(prefix, sequence)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects sequence %s', (sequence) => {
    expect(() => formatOrderNumber('NIM', sequence)).toThrow(RangeError);
  });
});
