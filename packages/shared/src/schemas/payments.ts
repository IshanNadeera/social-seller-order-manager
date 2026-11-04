// POST /orders/:id/payments and GET /orders/:id/payments (docs/DEVELOPMENT.md §7.7, ADR-014).
// The server checks the money rules (overpayment, refunds, closed orders) against the order itself.
import { z } from 'zod';
import { cents } from '../edit-lock.js';
import { PAYMENT_TYPES } from '../enums.js';
import { optionalText, searchListQueryFields } from './common.js';
import { moneySchema } from './money.js';

/** How far back "when the money changed hands" may go (§7.7). */
export const PAYMENT_BACKDATE_DAYS = 90;
export const PAYMENT_REFERENCE_MAX_LENGTH = 100;
export const PAYMENT_NOTES_MAX_LENGTH = 500;

/**
 * Methods a seller records by hand. COD money is recorded only by "Mark COD settled" (§7.8), so it
 * is never counted twice.
 */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'OTHER'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** A phone clock running a little ahead must not make "now" look like the future. */
const FUTURE_LEEWAY_MS = 5 * 60 * 1000;

/** §7.7: when money changed hands may be up to 90 days back, but not in the future. */
function checkMoneyDate(
  value: string | undefined,
  path: PropertyKey[],
  ctx: z.RefinementCtx,
): void {
  if (value === undefined) return;
  const at = Date.parse(value);
  const now = Date.now();
  if (at > now + FUTURE_LEEWAY_MS) {
    ctx.addIssue({ code: 'custom', path, message: 'This date is in the future.' });
  } else if (at < now - PAYMENT_BACKDATE_DAYS * DAY_MS) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `Use a date in the last ${PAYMENT_BACKDATE_DAYS} days.`,
    });
  }
}

export const paymentCreateSchema = z
  .strictObject({
    type: z.enum(PAYMENT_TYPES, { error: 'Choose payment or refund.' }),
    method: z.enum(MANUAL_PAYMENT_METHODS, {
      error:
        'Choose cash, bank transfer or other. Cash on delivery is recorded with “Mark COD settled”.',
    }),
    amount: moneySchema('Enter the amount.').refine((amount) => cents(amount) > 0n, {
      message: 'Enter an amount greater than 0.',
      // Only once the text is a valid amount: zod still runs refinements after a failed check.
      when: (payload) => payload.issues.length === 0,
    }),
    /** When the money changed hands (ISO 8601 with a time zone); now if left out. */
    occurredAt: z.iso
      .datetime({ offset: true, error: 'Enter when the money changed hands, as a date and time.' })
      .optional(),
    /** For a refund: the payment it gives back (optional, §7.7). */
    refundOfPaymentId: z.uuid({ error: 'Choose a payment from the list.' }).optional(),
    reference: optionalText(PAYMENT_REFERENCE_MAX_LENGTH),
    notes: optionalText(PAYMENT_NOTES_MAX_LENGTH),
  })
  .superRefine((input, ctx) => {
    if (input.refundOfPaymentId !== undefined && input.type !== 'REFUND') {
      ctx.addIssue({
        code: 'custom',
        path: ['refundOfPaymentId'],
        message: 'Only a refund can point to a payment.',
      });
    }
    checkMoneyDate(input.occurredAt, ['occurredAt'], ctx);
  });

export type PaymentCreateRequest = z.input<typeof paymentCreateSchema>;
export type PaymentCreateInput = z.output<typeof paymentCreateSchema>;

/** GET /orders/:id/payments: oldest first, in pages (§9.8). */
export const paymentListQuerySchema = z.strictObject({
  page: searchListQueryFields.page,
  pageSize: searchListQueryFields.pageSize,
});

export type PaymentListQuery = z.output<typeof paymentListQuerySchema>;

/**
 * POST /orders/:id/cod/settle (§7.8): the courier has paid over the COD money. Creates one COD
 * payment for the order's COD amount, dated `settledAt` (now if left out).
 */
export const codSettleSchema = z
  .strictObject({
    settledAt: z.iso
      .datetime({ offset: true, error: 'Enter when the courier paid you, as a date and time.' })
      .optional(),
    reference: optionalText(PAYMENT_REFERENCE_MAX_LENGTH),
    notes: optionalText(PAYMENT_NOTES_MAX_LENGTH),
  })
  .superRefine((input, ctx) => checkMoneyDate(input.settledAt, ['settledAt'], ctx));

export type CodSettleRequest = z.input<typeof codSettleSchema>;
export type CodSettleInput = z.output<typeof codSettleSchema>;
