import { describe, expect, it } from 'vitest';
import {
  customerOrdersQuerySchema,
  orderCancelSchema,
  orderCreateSchema,
  orderListQuerySchema,
  orderStatusChangeSchema,
  orderUpdateSchema,
} from '../index.js';

const CUSTOMER = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const PRODUCT = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';
const address = { recipientName: 'Nimali', phone: '077', addressLine1: '1 Lake Road' };
const base = {
  sourceChannel: 'WHATSAPP',
  customerId: CUSTOMER,
  items: [{ productId: PRODUCT, quantity: 2 }],
  paymentMethod: 'CASH',
  delivery: address,
};
const errors = (body: object) =>
  Object.fromEntries(
    (orderCreateSchema.safeParse(body).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('orderCreateSchema', () => {
  it('fills defaults and normalises money', () => {
    expect(
      orderCreateSchema.parse({
        ...base,
        items: [{ name: 'Wrap', quantity: 1, unitPrice: '200' }],
      }),
    ).toMatchObject({
      fulfilmentType: 'DELIVERY',
      discountAmount: '0.00',
      items: [{ unitPrice: '200.00' }],
    });
  });

  it('refuses client totals and unknown fields', () => {
    const result = orderCreateSchema.safeParse({ ...base, totalAmount: '1.00' });
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });

  it('needs a customer except for a walk-in pickup', () => {
    const walkIn = { ...base, customerId: null, sourceChannel: 'WALK_IN', delivery: undefined };
    expect(errors({ ...walkIn, fulfilmentType: 'PICKUP' })).toEqual({});
    expect(errors({ ...base, customerId: null })).toMatchObject({
      customerId: 'Choose a customer.',
    });
    expect(errors({ ...walkIn, delivery: address })).toMatchObject({
      fulfilmentType: 'An order without a customer must be a pickup.',
    });
  });

  it('matches delivery details to the fulfilment type', () => {
    expect(errors({ ...base, delivery: undefined })).toMatchObject({
      delivery: 'Enter the delivery address.',
    });
    expect(errors({ ...base, fulfilmentType: 'PICKUP', deliveryFee: '50' })).toMatchObject({
      delivery: 'A pickup order has no delivery address.',
      deliveryFee: 'A pickup order has no delivery fee.',
    });
  });

  it('COD only for delivery; an advance on COD names its own method', () => {
    expect(
      errors({ ...base, fulfilmentType: 'PICKUP', delivery: undefined, paymentMethod: 'COD' }),
    ).toMatchObject({
      paymentMethod: 'Cash on delivery is only for delivery orders.',
    });
    expect(
      errors({ ...base, paymentMethod: 'COD', initialPayment: { amount: '100' } }),
    ).toMatchObject({
      'initialPayment.method': 'Choose how the advance was paid, for example cash.',
    });
    expect(
      errors({ ...base, paymentMethod: 'COD', initialPayment: { amount: '100', method: 'CASH' } }),
    ).toEqual({});
  });

  it('needs a note for OTHER, and a name and price for a custom item', () => {
    expect(errors({ ...base, sourceChannel: 'OTHER' })).toMatchObject({
      sourceNote: 'Say where this order came from.',
    });
    expect(errors({ ...base, items: [{ quantity: 1 }] })).toMatchObject({
      'items.0.name': 'Enter the item name.',
      'items.0.unitPrice': 'Enter the price.',
    });
  });

  it('checks quantities and the number of items', () => {
    expect(errors({ ...base, items: [{ productId: PRODUCT, quantity: 0 }] })).toMatchObject({
      'items.0.quantity': 'Enter a whole number from 1 to 9,999.',
    });
    expect(errors({ ...base, items: [] })).toMatchObject({ items: 'Add at least one item.' });
  });
});

describe('orderListQuerySchema', () => {
  const issues = (query: object) =>
    Object.fromEntries(
      (orderListQuerySchema.safeParse(query).error?.issues ?? []).map((issue) => [
        issue.path.join('.'),
        issue.message,
      ]),
    );

  it('reads the §9.5 example query', () => {
    expect(
      orderListQuerySchema.parse({
        page: '1',
        pageSize: '25',
        orderStatus: 'READY',
        deliveryStatus: 'DISPATCHED',
        sourceChannel: 'WHATSAPP',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({
      page: 1,
      pageSize: 25,
      orderStatus: 'READY',
      deliveryStatus: 'DISPATCHED',
      sourceChannel: 'WHATSAPP',
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('caps pageSize at 100 and refuses unknown filters', () => {
    expect(issues({ pageSize: '101' })).toEqual({ pageSize: 'Use at most 100.' });
    expect(orderListQuerySchema.safeParse({ includeArchived: 'true' }).success).toBe(false);
  });

  it('checks the dates: real dates, from ≤ to, at most 366 days', () => {
    expect(issues({ from: '2026-02-30' })).toMatchObject({
      from: expect.stringContaining('YYYY-MM-DD') as string,
    });
    expect(issues({ from: '2026-10-02', to: '2026-10-01' })).toEqual({
      to: 'The end date must be on or after the start date.',
    });
    expect(issues({ from: '2024-01-01', to: '2024-12-31' })).toEqual({}); // 366 days
    expect(issues({ from: '2025-01-01', to: '2026-01-02' })).toEqual({
      to: 'Choose a range of at most 366 days.',
    });
  });

  it('refuses statuses that do not exist', () => {
    expect(issues({ orderStatus: 'SHIPPED' })).toEqual({
      orderStatus: 'Choose an order status from the list.',
    });
  });
});

describe('orderUpdateSchema', () => {
  const updateErrors = (body: object) =>
    Object.fromEntries(
      (orderUpdateSchema.safeParse(body).error?.issues ?? []).map((issue) => [
        issue.path.join('.'),
        issue.message,
      ]),
    );

  it('takes only what changes, and normalises money', () => {
    expect(orderUpdateSchema.parse({ discountAmount: '50' })).toEqual({ discountAmount: '50.00' });
    expect(orderUpdateSchema.parse({ notes: '' })).toEqual({ notes: null });
  });

  it('refuses an empty edit, client totals, business IDs and statuses', () => {
    expect(updateErrors({})).toEqual({ '': 'Change at least one field.' });
    for (const field of ['totalAmount', 'businessId', 'orderStatus', 'customerId']) {
      const result = orderUpdateSchema.safeParse({ notes: 'x', [field]: 'y' });
      expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('checks replaced items like create does', () => {
    expect(updateErrors({ items: [] })).toEqual({ items: 'Add at least one item.' });
    expect(updateErrors({ items: [{ quantity: 1 }] })).toEqual({
      'items.0.name': 'Enter the item name.',
      'items.0.unitPrice': 'Enter the price.',
    });
    expect(updateErrors({ items: [{ productId: PRODUCT, name: 'X', quantity: 1 }] })).toEqual({
      'items.0.name': 'A catalogue product uses its own name.',
    });
  });

  it('matches a fulfilment switch with its address, fee and payment method', () => {
    expect(updateErrors({ fulfilmentType: 'DELIVERY', delivery: address })).toEqual({});
    expect(updateErrors({ delivery: address })).toEqual({
      delivery: 'Send the address only when switching the order to delivery.',
    });
    expect(
      updateErrors({ fulfilmentType: 'PICKUP', deliveryFee: '350', paymentMethod: 'COD' }),
    ).toEqual({
      deliveryFee: 'A pickup order has no delivery fee.',
      paymentMethod: 'Cash on delivery is only for delivery orders.',
    });
    expect(updateErrors({ fulfilmentType: 'PICKUP', paymentMethod: 'CASH' })).toEqual({});
  });
});

describe('status change and cancel', () => {
  const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
    Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
    );

  it('takes a status and an optional reason', () => {
    expect(orderStatusChangeSchema.parse({ to: 'CONFIRMED' })).toMatchObject({ to: 'CONFIRMED' });
    expect(orderStatusChangeSchema.parse({ to: 'CANCELLED', reason: '  Out of stock ' })).toEqual({
      to: 'CANCELLED',
      reason: 'Out of stock',
    });
    expect(issues(orderStatusChangeSchema.safeParse({ to: 'SHIPPED' }))).toEqual({
      to: 'Choose a status from the list.',
    });
    expect(
      issues(orderStatusChangeSchema.safeParse({ to: 'READY', reason: 'x'.repeat(501) })),
    ).toEqual({
      reason: 'Use at most 500 characters.',
    });
  });

  it('cancel always needs a reason', () => {
    expect(orderCancelSchema.parse({ reason: ' Customer asked ' })).toEqual({
      reason: 'Customer asked',
    });
    expect(issues(orderCancelSchema.safeParse({}))).toEqual({ reason: 'Please give a reason.' });
    expect(issues(orderCancelSchema.safeParse({ reason: '   ' }))).toEqual({
      reason: 'Please give a reason.',
    });
  });
});

describe('customerOrdersQuerySchema', () => {
  it('pages like every list: defaults, at most 100, nothing else', () => {
    expect(customerOrdersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(customerOrdersQuerySchema.parse({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10,
    });
    expect(customerOrdersQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(customerOrdersQuerySchema.safeParse({ orderStatus: 'NEW' }).success).toBe(false);
  });
});
