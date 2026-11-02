// The only place order money is calculated (docs/DEVELOPMENT.md §7.5, ADR-008, ADR-011).
// Amounts are decimal strings in and out ("1500.00"); maths uses decimal.js, never JavaScript numbers.
import Decimal from 'decimal.js';

/** Its own Decimal: half-up rounding and ample precision, without touching decimal.js's global settings. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = Decimal;

/** NUMERIC(12,2): every stored amount fits (§7.5). */
export const MAX_AMOUNT = '99999999.99';
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 9999;

export type OrderCalculationErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_QUANTITY'
  | 'AMOUNT_TOO_LARGE'
  | 'DISCOUNT_EXCEEDS_SUBTOTAL';

/** A rule of §7.5 was broken. The order service turns it into a 422 with this code. */
export class OrderCalculationError extends Error {
  constructor(
    readonly code: OrderCalculationErrorCode,
    message: string,
    /** Which input, e.g. "items[2].unitPrice" or "discountAmount" (§9.7 fieldErrors key). */
    readonly field: string,
  ) {
    super(message);
    this.name = 'OrderCalculationError';
  }
}

export interface LineInput {
  quantity: number;
  /** e.g. "1500.00" */
  unitPrice: string;
}

export interface OrderTotalsInput {
  items: readonly LineInput[];
  discountAmount: string;
  deliveryFee: string;
}

export interface OrderTotals {
  /** line_total per item, in the same order as the input. */
  lineTotals: string[];
  subtotal: string;
  discountAmount: string;
  deliveryFee: string;
  totalAmount: string;
}

const MAX = new D(MAX_AMOUNT);

/** A non-negative decimal string, or the error naming `field`. */
function amount(value: string, field: string): Dec {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new OrderCalculationError('INVALID_AMOUNT', 'Enter an amount of 0 or more.', field);
  }
  return new D(value.trim());
}

function withinMax(value: Dec, field: string): Dec {
  if (value.greaterThan(MAX)) {
    throw new OrderCalculationError(
      'AMOUNT_TOO_LARGE',
      'This amount is too large. The most is 99,999,999.99.',
      field,
    );
  }
  return value;
}

const money = (value: Dec) => value.toFixed(2);

/** quantity × unit price, rounded half-up to 2 decimals: the only rounding step (§7.5). */
export function lineTotal(quantity: number, unitPrice: string, field = 'items[0]'): string {
  if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw new OrderCalculationError(
      'INVALID_QUANTITY',
      `Enter a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`,
      `${field}.quantity`,
    );
  }
  const price = withinMax(amount(unitPrice, `${field}.unitPrice`), `${field}.unitPrice`);
  const total = price.times(quantity).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return money(withinMax(total, `${field}.unitPrice`));
}

/**
 * subtotal = Σ line totals; total = subtotal − discount + delivery fee (§7.5).
 * Rules: 0 ≤ discount ≤ subtotal (one fixed order-level discount, ADR-008); delivery fee ≥ 0;
 * every amount ≤ 99,999,999.99. Discount and fee are kept to 2 decimals exactly as given.
 */
export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  const lineTotals = input.items.map((item, index) =>
    lineTotal(item.quantity, item.unitPrice, `items[${index}]`),
  );
  const subtotal = withinMax(
    lineTotals.reduce((sum, line) => sum.plus(line), new D(0)),
    'items',
  );
  const discount = twoDecimals(amount(input.discountAmount, 'discountAmount'), 'discountAmount');
  const fee = withinMax(
    twoDecimals(amount(input.deliveryFee, 'deliveryFee'), 'deliveryFee'),
    'deliveryFee',
  );
  if (discount.greaterThan(subtotal)) {
    throw new OrderCalculationError(
      'DISCOUNT_EXCEEDS_SUBTOTAL',
      'The discount can’t be more than the items’ subtotal.',
      'discountAmount',
    );
  }
  const total = withinMax(subtotal.minus(discount).plus(fee), 'totalAmount');
  return {
    lineTotals,
    subtotal: money(subtotal),
    discountAmount: money(discount),
    deliveryFee: money(fee),
    totalAmount: money(total),
  };
}

/** Discount and fee are entered amounts, not results: more than 2 decimals is refused, not rounded. */
function twoDecimals(value: Dec, field: string): Dec {
  if (value.decimalPlaces() > 2) {
    throw new OrderCalculationError('INVALID_AMOUNT', 'Use at most 2 decimals.', field);
  }
  return value;
}

export interface BalanceInput {
  totalAmount: string;
  /** Sum of PAYMENT records. */
  amountPaid: string;
  /** Sum of REFUND records. */
  amountRefunded: string;
  /** CANCELLED and RETURNED orders owe nothing more; money held is owed back. */
  closed: boolean;
}

export interface Balance {
  netPaid: string;
  balanceDue: string;
  refundOwed: string;
}

/**
 * §7.5: net_paid = paid − refunded; balance_due = max(0, total − net_paid) for active orders, 0 for
 * cancelled/returned; refund_owed = net_paid for cancelled/returned, 0 otherwise.
 */
export function calculateBalance(input: BalanceInput): Balance {
  const total = amount(input.totalAmount, 'totalAmount');
  const netPaid = amount(input.amountPaid, 'amountPaid').minus(
    amount(input.amountRefunded, 'amountRefunded'),
  );
  const zero = new D(0);
  const balanceDue = input.closed ? zero : D.max(zero, total.minus(netPaid));
  const refundOwed = input.closed ? D.max(zero, netPaid) : zero;
  return { netPaid: money(netPaid), balanceDue: money(balanceDue), refundOwed: money(refundOwed) };
}
