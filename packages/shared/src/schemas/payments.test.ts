import { describe, expect, it } from 'vitest';
import { codSettleSchema, paymentCreateSchema, paymentListQuerySchema } from '../index.js';

const DAY = 24 * 60 * 60 * 1000;
const errors = (body: object) =>
  Object.fromEntries(
    (paymentCreateSchema.safeParse(body).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );
const base = { type: 'PAYMENT', method: 'CASH', amount: '1000' };

describe('paymentCreateSchema (§7.7)', () => {
  it('normalises the amount; occurredAt, reference and notes are optional', () => {
    expect(paymentCreateSchema.parse(base)).toMatchObject({ amount: '1000.00' });
    expect(errors({ ...base, reference: 'BOC 123', notes: '' })).toEqual({});
  });

  it('refuses zero, COD (recorded by settling) and client-side extras', () => {
    expect(errors({ ...base, amount: '0' })).toEqual({ amount: 'Enter an amount greater than 0.' });
    expect(Object.keys(errors({ ...base, method: 'COD' }))).toEqual(['method']);
    for (const field of ['orderId', 'businessId', 'recordedById', 'createdAt']) {
      const result = paymentCreateSchema.safeParse({ ...base, [field]: 'x' });
      expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('allows backdating up to 90 days, not the future', () => {
    const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    expect(errors({ ...base, occurredAt: ago(89) })).toEqual({});
    expect(errors({ ...base, occurredAt: ago(91) })).toEqual({
      occurredAt: 'Use a date in the last 90 days.',
    });
    expect(errors({ ...base, occurredAt: new Date(Date.now() + DAY).toISOString() })).toEqual({
      occurredAt: 'This date is in the future.',
    });
    expect(Object.keys(errors({ ...base, occurredAt: '2026-11-01' }))).toEqual(['occurredAt']);
  });

  it('only a refund points to a payment', () => {
    const refundOfPaymentId = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';
    expect(errors({ ...base, type: 'REFUND', refundOfPaymentId })).toEqual({});
    expect(errors({ ...base, refundOfPaymentId })).toEqual({
      refundOfPaymentId: 'Only a refund can point to a payment.',
    });
  });

  it('pages the list like every list', () => {
    expect(paymentListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paymentListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

describe('codSettleSchema (§7.8)', () => {
  it('takes an optional settlement date (90 days back at most), reference and notes; no amount', () => {
    expect(codSettleSchema.parse({})).toEqual({});
    const settledAt = new Date(Date.now() - 3 * DAY).toISOString();
    expect(codSettleSchema.parse({ settledAt, reference: 'Domex remit 7' })).toMatchObject({
      settledAt,
    });
    expect(
      codSettleSchema.safeParse({ settledAt: new Date(Date.now() - 91 * DAY).toISOString() }).error
        ?.issues[0]?.message,
    ).toBe('Use a date in the last 90 days.');
    // The amount is the order's COD amount, never the client's.
    expect(codSettleSchema.safeParse({ amount: '100.00' }).success).toBe(false);
  });
});
