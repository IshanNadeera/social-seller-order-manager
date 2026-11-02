import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from '../index.js';

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
