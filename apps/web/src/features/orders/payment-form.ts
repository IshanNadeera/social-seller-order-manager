// The payment and refund form (docs/DEVELOPMENT.md §6.5, §7.7). The form holds what the seller typed;
// toPaymentRequest() turns it into the POST /orders/:id/payments body, which the shared
// paymentCreateSchema checks, the same schema the API uses. Field names match the request, so the
// API's field errors land on the right field.
import { codSettleSchema, paymentCreateSchema } from '@ssom/shared';
import type {
  CodSettleInput,
  ManualPaymentMethod,
  PaymentCreateInput,
  PaymentType,
} from '@ssom/shared';
import { z } from 'zod';

export type PaymentFormValues = {
  amount: string;
  method: ManualPaymentMethod | '';
  /** A day (YYYY-MM-DD) in the seller's own time zone. */
  occurredAt: string;
  refundOfPaymentId: string;
  reference: string;
  notes: string;
};

/** Today as YYYY-MM-DD on this device's clock. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyPaymentForm(amount: string, today: string = localToday()): PaymentFormValues {
  return { amount, method: '', occurredAt: today, refundOfPaymentId: '', reference: '', notes: '' };
}

const blankToUndefined = (value: string) => (value.trim() === '' ? undefined : value);

/**
 * "When" as the API wants it. Today means now (the server's clock); an earlier day is midday of that
 * day on this device, so the date never shifts across midnight.
 */
export function occurredAtOf(day: string, today: string): string | undefined {
  if (day.trim() === '' || day === today) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const midday = new Date(`${day}T12:00:00`);
  return Number.isNaN(midday.getTime()) ? day : midday.toISOString();
}

/** The POST body for these values, before validation. A refund link only goes with a refund. */
export function toPaymentRequest(
  values: PaymentFormValues,
  type: PaymentType,
  today: string = localToday(),
): Record<string, unknown> {
  return {
    type,
    method: blankToUndefined(values.method),
    amount: values.amount,
    occurredAt: occurredAtOf(values.occurredAt, today),
    refundOfPaymentId: type === 'REFUND' ? blankToUndefined(values.refundOfPaymentId) : undefined,
    reference: values.reference,
    notes: values.notes,
  };
}

/** The form's validation: the values, as a request, against the API's own schema. */
export function paymentFormSchema(type: PaymentType) {
  return z.preprocess(
    (values) => toPaymentRequest(values as PaymentFormValues, type),
    paymentCreateSchema,
  ) as unknown as z.ZodType<PaymentCreateInput, PaymentFormValues>;
}

// ---------- Settling COD (§7.2, §7.7) ----------

export type CodSettleFormValues = {
  /** The day the courier paid the seller (YYYY-MM-DD), in the seller's own time zone. */
  settledAt: string;
  reference: string;
  notes: string;
};

export function emptyCodSettleForm(today: string = localToday()): CodSettleFormValues {
  return { settledAt: today, reference: '', notes: '' };
}

/** The POST /orders/:id/cod/settle body for these values, before validation. */
export function toCodSettleRequest(
  values: CodSettleFormValues,
  today: string = localToday(),
): Record<string, unknown> {
  return {
    settledAt: occurredAtOf(values.settledAt, today),
    reference: values.reference,
    notes: values.notes,
  };
}

/** The settle form's validation: the values, as a request, against the API's own schema. */
export function codSettleFormSchema() {
  return z.preprocess(
    (values) => toCodSettleRequest(values as CodSettleFormValues),
    codSettleSchema,
  ) as unknown as z.ZodType<CodSettleInput, CodSettleFormValues>;
}
