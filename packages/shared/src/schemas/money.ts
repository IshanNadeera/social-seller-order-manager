// Money in requests (docs/DEVELOPMENT.md §7.5, ADR-011). Amounts travel as strings such as "1500.00",
// never as JavaScript numbers, and fit NUMERIC(12,2): at most 99,999,999.99.
import { z } from 'zod';

export const MONEY_MAX = '99999999.99';

/** 0 or more, up to 8 digits before the point and 2 after; no sign, no leading zeros, no grouping. */
const MONEY_PATTERN = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;

/** Always two decimals: "1500" → "1500.00", "12.5" → "12.50". Input must already match MONEY_PATTERN. */
export function toMoneyString(amount: string): string {
  const dot = amount.indexOf('.');
  if (dot === -1) return `${amount}.00`;
  return amount.slice(0, dot + 1) + amount.slice(dot + 1).padEnd(2, '0');
}

/**
 * A money amount from a request: a string, trimmed, 0 to 99,999,999.99 with at most 2 decimals.
 * The output is normalised to two decimals, ready for Prisma's Decimal.
 */
export const moneySchema = (missing = 'Enter an amount.') =>
  z
    .string({
      error: (issue) =>
        issue.input === undefined ? missing : 'Enter the amount as text, like "1500.00".',
    })
    .trim()
    .min(1, { error: missing, abort: true })
    .regex(MONEY_PATTERN, 'Enter an amount from 0 to 99,999,999.99, with at most 2 decimals.')
    .transform(toMoneyString);
