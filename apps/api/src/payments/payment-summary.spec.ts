// §7.6 payment status rules (all five statuses and their edges).
import { describe, expect, it } from 'vitest';
import { paymentStatusFor } from './payment-summary';

describe('paymentStatusFor (total 1000.00)', () => {
  it.each([
    ['0.00', '0.00', 'UNPAID'],
    ['400.00', '0.00', 'PARTIALLY_PAID'],
    ['999.99', '0.00', 'PARTIALLY_PAID'],
    ['1000.00', '0.00', 'PAID'],
    ['1000.00', '200.00', 'PARTIALLY_REFUNDED'],
    ['400.00', '100.00', 'PARTIALLY_REFUNDED'],
    ['1000.00', '1000.00', 'REFUNDED'],
    ['300.00', '300.00', 'REFUNDED'],
  ] as const)('paid %s, refunded %s → %s', (paid, refunded, status) => {
    expect(paymentStatusFor('1000.00', paid, refunded)).toBe(status);
  });

  it('PAID covers more than the total (a total edited down after payment)', () => {
    expect(paymentStatusFor('500.00', '800.00', '0.00')).toBe('PAID');
  });

  it('a free order with nothing paid is UNPAID (paid = 0 is checked first)', () => {
    expect(paymentStatusFor('0.00', '0.00', '0.00')).toBe('UNPAID');
  });

  it('compares exactly, with no floating-point error', () => {
    expect(paymentStatusFor('0.30', '0.30', '0')).toBe('PAID');
    expect(paymentStatusFor('0.30', '0.29', '0')).toBe('PARTIALLY_PAID');
  });
});
