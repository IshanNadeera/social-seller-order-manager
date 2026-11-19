// GET /orders/possible-duplicates (docs/DEVELOPMENT.md §2.2): before saving, the order form asks
// whether a similar order was just made for the same customer phone. It is only ever a warning;
// saving is never blocked.
import { z } from 'zod';
import { moneySchema } from './money.js';

/** How far back an order counts as "just made". */
export const DUPLICATE_WINDOW_MINUTES = 30;
/** Totals within this share of each other count as similar (10%: LKR 2,450 vs 2,300 is similar). */
export const DUPLICATE_TOTAL_TOLERANCE = 0.1;
/** At most this many possible duplicates are listed. */
export const DUPLICATE_MAX_RESULTS = 5;

export const duplicateCheckQuerySchema = z.strictObject({
  customerId: z.uuid({ error: 'Choose a customer from the list.' }),
  /** The total the form shows now (a preview; the server calculates the real one on save). */
  total: moneySchema('Enter the total as an amount, like 2450.00.'),
});

export type DuplicateCheckQuery = z.output<typeof duplicateCheckQuerySchema>;
