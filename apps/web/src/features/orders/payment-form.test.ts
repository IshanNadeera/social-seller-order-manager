import { describe, expect, it } from 'vitest';
import {
  codSettleFormSchema,
  emptyCodSettleForm,
  emptyPaymentForm,
  localToday,
  paymentFormSchema,
  toCodSettleRequest,
  toPaymentRequest,
} from './payment-form';

const TODAY = localToday();
const daysAgo = (days: number) => localToday(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

describe('payment form (§6.5, §7.7)', () => {
  it('today means now; an earlier day is that day; blanks are left out', () => {
    const today = toPaymentRequest({ ...emptyPaymentForm('500'), method: 'CASH' }, 'PAYMENT');
    expect(today).toMatchObject({ type: 'PAYMENT', method: 'CASH', amount: '500', occurredAt: undefined });
    const earlier = toPaymentRequest({ ...emptyPaymentForm('500'), occurredAt: daysAgo(3) }, 'PAYMENT');
    expect(new Date(earlier.occurredAt as string).getDate()).toBe(new Date(`${daysAgo(3)}T12:00:00`).getDate());
  });

  it('a refund link only goes with a refund', () => {
    const values = { ...emptyPaymentForm('100'), method: 'CASH' as const, refundOfPaymentId: '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e' };
    expect(toPaymentRequest(values, 'PAYMENT').refundOfPaymentId).toBeUndefined();
    expect(toPaymentRequest(values, 'REFUND').refundOfPaymentId).toBe(values.refundOfPaymentId);
  });

  it('is checked with the API’s own rules, on the form’s field names', () => {
    const issues = (values: object) =>
      (paymentFormSchema('PAYMENT').safeParse({ ...emptyPaymentForm(''), ...values }).error?.issues ?? []).map(
        (issue) => issue.path.join('.'),
      );
    expect(issues({})).toEqual(expect.arrayContaining(['amount', 'method']));
    expect(issues({ amount: '10', method: 'CASH', occurredAt: daysAgo(100) })).toEqual(['occurredAt']);
    expect(issues({ amount: '10', method: 'CASH', occurredAt: 'yesterday' })).toEqual(['occurredAt']);
    expect(paymentFormSchema('PAYMENT').parse({ ...emptyPaymentForm('10'), method: 'BANK_TRANSFER' })).toMatchObject({
      amount: '10.00',
      method: 'BANK_TRANSFER',
    });
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('COD settle form (§7.7)', () => {
  it('today means now; an earlier day is midday of that day', () => {
    expect(toCodSettleRequest(emptyCodSettleForm())).toEqual({ settledAt: undefined, reference: '', notes: '' });
    const earlier = toCodSettleRequest({ ...emptyCodSettleForm(), settledAt: daysAgo(2) });
    expect(new Date(earlier.settledAt as string).getDate()).toBe(new Date(`${daysAgo(2)}T12:00:00`).getDate());
  });

  it('checks the date with the API’s own rules', () => {
    const schema = codSettleFormSchema();
    expect(schema.safeParse({ ...emptyCodSettleForm(), reference: 'KB 7' }).data).toEqual({ reference: 'KB 7', notes: null });
    expect(schema.safeParse({ ...emptyCodSettleForm(), settledAt: daysAgo(120) }).success).toBe(false);
  });
});
