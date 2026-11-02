import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it.each([
    ['1500.00', 'LKR 1,500.00'],
    ['0.00', 'LKR 0.00'],
    ['999.5', 'LKR 999.50'],
    ['1000', 'LKR 1,000.00'],
    ['99999999.99', 'LKR 99,999,999.99'],
    ['-250.00', '-LKR 250.00'],
  ])('shows %s as %s', (amount, shown) => {
    expect(formatMoney(amount, 'LKR')).toBe(shown);
  });

  it('keeps every digit of large amounts (no floating-point rounding)', () => {
    // As a JavaScript number this would come out as 90071992547409.92 or similar.
    expect(formatMoney('90071992547409.93', 'LKR')).toBe('LKR 90,071,992,547,409.93');
  });

  it('shows anything unexpected as it came, rather than guessing', () => {
    expect(formatMoney('n/a', 'LKR')).toBe('LKR n/a');
  });
});
