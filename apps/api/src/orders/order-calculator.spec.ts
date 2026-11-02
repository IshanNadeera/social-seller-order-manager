// Order money rules (docs/DEVELOPMENT.md §7.5, §12.1, ADR-008, ADR-011).
import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT,
  OrderCalculationError,
  calculateBalance,
  calculateOrderTotals,
  lineTotal,
} from './order-calculator';

/** Runs `fn` and returns the OrderCalculationError it throws, as { code, field }. */
function failure(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof OrderCalculationError) return { code: error.code, field: error.field };
    throw error;
  }
  throw new Error('expected an OrderCalculationError');
}

const totals = (
  items: { quantity: number; unitPrice: string }[],
  discountAmount = '0',
  deliveryFee = '0',
) => calculateOrderTotals({ items, discountAmount, deliveryFee });

describe('lineTotal', () => {
  it.each([
    [2, '1500.00', '3000.00'],
    [1, '0', '0.00'],
    [3, '0.10', '0.30'], // exact: 0.1 * 3 is 0.30000000000000004 in floating point
    [9999, '10000.00', '99990000.00'],
  ])('%i × %s = %s', (quantity, unitPrice, expected) => {
    expect(lineTotal(quantity, unitPrice)).toBe(expected);
  });

  it('rounds half-up to 2 decimals, at the line only', () => {
    expect(lineTotal(1, '0.005')).toBe('0.01');
    expect(lineTotal(1, '0.004')).toBe('0.00');
    expect(lineTotal(3, '0.335')).toBe('1.01'); // 1.005 → 1.01 (half-up, not banker's)
    expect(lineTotal(1, '2.675')).toBe('2.68'); // 2.675 is 2.67499… as a float
  });

  it.each([0, -1, 10000, 1.5, Number.NaN])('refuses quantity %s', (quantity) => {
    expect(failure(() => lineTotal(quantity, '1', 'items[3]'))).toEqual({
      code: 'INVALID_QUANTITY',
      field: 'items[3].quantity',
    });
  });

  it.each(['-1', 'abc', '', '1e3', '1,500'])('refuses unit price %j', (unitPrice) => {
    expect(failure(() => lineTotal(1, unitPrice))).toEqual({
      code: 'INVALID_AMOUNT',
      field: 'items[0].unitPrice',
    });
  });

  it('refuses a unit price or a line total above 99,999,999.99', () => {
    expect(failure(() => lineTotal(1, '100000000'))).toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    expect(failure(() => lineTotal(2, '50000000.00'))).toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    expect(lineTotal(1, MAX_AMOUNT)).toBe(MAX_AMOUNT);
  });
});

describe('calculateOrderTotals', () => {
  it('adds the lines, takes off the discount and adds the delivery fee', () => {
    // §9.6's example: 2 × 1500 + 1 × 200, discount 100, delivery 350.
    expect(
      totals(
        [
          { quantity: 2, unitPrice: '1500.00' },
          { quantity: 1, unitPrice: '200.00' },
        ],
        '100.00',
        '350.00',
      ),
    ).toEqual({
      lineTotals: ['3000.00', '200.00'],
      subtotal: '3200.00',
      discountAmount: '100.00',
      deliveryFee: '350.00',
      totalAmount: '3450.00',
    });
  });

  it('formats every amount with two decimals', () => {
    expect(totals([{ quantity: 1, unitPrice: '5' }], '1', '2.5')).toMatchObject({
      subtotal: '5.00',
      discountAmount: '1.00',
      deliveryFee: '2.50',
      totalAmount: '6.50',
    });
  });

  it('sums rounded line totals, so the lines always add up to the subtotal', () => {
    const result = totals([
      { quantity: 1, unitPrice: '0.005' },
      { quantity: 1, unitPrice: '0.005' },
    ]);
    expect(result.lineTotals).toEqual(['0.01', '0.01']);
    expect(result.subtotal).toBe('0.02'); // not round(0.010) = 0.01
  });

  it('allows a discount equal to the subtotal, and a free order', () => {
    expect(totals([{ quantity: 1, unitPrice: '500' }], '500').totalAmount).toBe('0.00');
    expect(totals([{ quantity: 1, unitPrice: '0' }]).totalAmount).toBe('0.00');
    expect(totals([]).totalAmount).toBe('0.00');
  });

  it('refuses a discount above the subtotal, even when the delivery fee would cover it', () => {
    expect(failure(() => totals([{ quantity: 1, unitPrice: '500' }], '500.01', '1000'))).toEqual({
      code: 'DISCOUNT_EXCEEDS_SUBTOTAL',
      field: 'discountAmount',
    });
  });

  it.each([
    ['discountAmount', '-1', '0'],
    ['deliveryFee', '0', '-5'],
    ['discountAmount', '1.005', '0'],
    ['deliveryFee', '0', '1.999'],
  ])('refuses a negative or over-precise %s', (field, discount, fee) => {
    expect(failure(() => totals([{ quantity: 1, unitPrice: '100' }], discount, fee))).toEqual({
      code: 'INVALID_AMOUNT',
      field,
    });
  });

  it('refuses a subtotal, delivery fee or total above 99,999,999.99', () => {
    const big = { quantity: 1, unitPrice: '60000000.00' };
    expect(failure(() => totals([big, big]))).toEqual({ code: 'AMOUNT_TOO_LARGE', field: 'items' });
    expect(failure(() => totals([], '0', '100000000'))).toEqual({
      code: 'AMOUNT_TOO_LARGE',
      field: 'deliveryFee',
    });
    expect(failure(() => totals([{ quantity: 1, unitPrice: MAX_AMOUNT }], '0', '0.01'))).toEqual({
      code: 'AMOUNT_TOO_LARGE',
      field: 'totalAmount',
    });
  });

  it('names the failing line', () => {
    expect(
      failure(() =>
        totals([
          { quantity: 1, unitPrice: '1' },
          { quantity: 0, unitPrice: '1' },
        ]),
      ),
    ).toEqual({ code: 'INVALID_QUANTITY', field: 'items[1].quantity' });
  });
});

describe('calculateBalance', () => {
  const balance = (paid: string, refunded: string, closed = false) =>
    calculateBalance({
      totalAmount: '1000.00',
      amountPaid: paid,
      amountRefunded: refunded,
      closed,
    });

  it('active order: balance due is what is left to pay, never below zero', () => {
    expect(balance('0', '0')).toEqual({
      netPaid: '0.00',
      balanceDue: '1000.00',
      refundOwed: '0.00',
    });
    expect(balance('400', '0')).toEqual({
      netPaid: '400.00',
      balanceDue: '600.00',
      refundOwed: '0.00',
    });
    expect(balance('1000', '200')).toEqual({
      netPaid: '800.00',
      balanceDue: '200.00',
      refundOwed: '0.00',
    });
    // The total was edited below what was paid: nothing due (refund decisions are §7.4's).
    expect(
      calculateBalance({
        totalAmount: '500',
        amountPaid: '800',
        amountRefunded: '0',
        closed: false,
      }),
    ).toEqual({ netPaid: '800.00', balanceDue: '0.00', refundOwed: '0.00' });
  });

  it('cancelled or returned order: nothing due, and the money held is owed back', () => {
    expect(balance('600', '100', true)).toEqual({
      netPaid: '500.00',
      balanceDue: '0.00',
      refundOwed: '500.00',
    });
    expect(balance('0', '0', true)).toEqual({
      netPaid: '0.00',
      balanceDue: '0.00',
      refundOwed: '0.00',
    });
  });

  it('refuses amounts that are not decimal strings', () => {
    expect(failure(() => balance('x', '0'))).toEqual({
      code: 'INVALID_AMOUNT',
      field: 'amountPaid',
    });
  });
});
