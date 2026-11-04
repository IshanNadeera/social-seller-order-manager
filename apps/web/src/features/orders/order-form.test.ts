import { describe, expect, it } from 'vitest';
import {
  emptyItem,
  emptyOrderForm,
  formFieldName,
  orderFormSchema,
  previewOrder,
  toOrderRequest,
} from './order-form';
import type { OrderFormValues } from './order-form';

const PRODUCT = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';
const CUSTOMER = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

/** §9.6's example: 2 × 1500 + gift wrap 200, discount 100, fee 350. */
function example(overrides: Partial<OrderFormValues> = {}): OrderFormValues {
  const form = emptyOrderForm('350.00');
  return {
    ...form,
    sourceChannel: 'WHATSAPP',
    customerId: CUSTOMER,
    delivery: {
      ...form.delivery,
      recipientName: 'Nimali',
      phone: '0771234567',
      addressLine1: '1 Lake Road',
    },
    items: [
      { productId: PRODUCT, name: 'Silk Saree', quantity: '2', unitPrice: '1500.00' },
      { productId: '', name: 'Gift wrapping', quantity: '1', unitPrice: '200' },
    ],
    discountAmount: '100',
    paymentMethod: 'COD',
    ...overrides,
  };
}

describe('previewOrder (§7.5)', () => {
  it('adds up lines, discount and fee, exactly', () => {
    expect(previewOrder(example({ initialPayment: { amount: '1000', method: 'CASH' } }))).toEqual({
      lineTotals: ['3000.00', '200.00'],
      subtotal: '3200.00',
      discount: '100.00',
      deliveryFee: '350.00',
      total: '3450.00',
      received: '1000.00',
      balance: '2450.00',
    });
    // 0.1 + 0.2 style sums stay exact.
    const cents = example({
      items: [{ ...emptyItem(), name: 'x', quantity: '3', unitPrice: '0.10' }],
      discountAmount: '',
    });
    expect(previewOrder(cents)).toMatchObject({ subtotal: '0.30', total: '350.30' });
  });

  it('a pickup order has no delivery fee; overpaying shows no negative balance', () => {
    const pickup = example({
      fulfilmentType: 'PICKUP',
      initialPayment: { amount: '5000', method: '' },
    });
    expect(previewOrder(pickup)).toMatchObject({
      deliveryFee: '0.00',
      total: '3100.00',
      balance: '0.00',
    });
  });

  it('shows no total while a line is incomplete or invalid', () => {
    const preview = previewOrder(
      example({ items: [{ ...emptyItem(), quantity: '1.5', unitPrice: '10' }] }),
    );
    expect(preview).toMatchObject({
      lineTotals: [null],
      subtotal: null,
      total: null,
      balance: null,
    });
    expect(previewOrder(example({ discountAmount: 'abc' })).total).toBeNull();
  });
});

describe('toOrderRequest and the schema', () => {
  it('builds the POST /orders body: no names for products, no blanks', () => {
    expect(orderFormSchema.parse(example())).toEqual(
      expect.objectContaining({
        sourceChannel: 'WHATSAPP',
        customerId: CUSTOMER,
        fulfilmentType: 'DELIVERY',
        items: [
          { productId: PRODUCT, quantity: 2, unitPrice: '1500.00' },
          { name: 'Gift wrapping', quantity: 1, unitPrice: '200.00' },
        ],
        discountAmount: '100.00',
        deliveryFee: '350.00',
        paymentMethod: 'COD',
      }),
    );
    const body = toOrderRequest(example());
    expect(body.initialPayment).toBeUndefined();
    expect(body.delivery).toMatchObject({ sourceAddressId: undefined, saveToCustomer: undefined });
  });

  it('leaves out the address and fee of a pickup order, and sends no customer for a walk-in', () => {
    const body = toOrderRequest(
      example({
        fulfilmentType: 'PICKUP',
        customerId: '',
        sourceChannel: 'WALK_IN',
        paymentMethod: 'CASH',
      }),
    );
    expect(body).toMatchObject({ customerId: null, delivery: undefined, deliveryFee: undefined });
    expect(
      orderFormSchema.safeParse(
        example({
          fulfilmentType: 'PICKUP',
          customerId: '',
          sourceChannel: 'WALK_IN',
          paymentMethod: 'CASH',
        }),
      ).success,
    ).toBe(true);
  });

  it('saves a typed address to the customer only when asked and not from a saved one', () => {
    const typed = example();
    typed.delivery.saveToCustomer = true;
    expect(toOrderRequest(typed).delivery).toMatchObject({ saveToCustomer: true });
    typed.delivery.sourceAddressId = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
    expect(toOrderRequest(typed).delivery).toMatchObject({ saveToCustomer: undefined });
  });

  it('reports errors on the form field names', () => {
    const result = orderFormSchema.safeParse(
      example({
        sourceChannel: '',
        items: [{ ...emptyItem(), quantity: '0' }],
        delivery: { ...emptyOrderForm('0').delivery },
      }),
    );
    const paths = (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['sourceChannel', 'items.0.quantity', 'delivery.recipientName']),
    );
    // Cross-field rules (a one-off item needs a name and price) run once the fields themselves pass.
    const custom = orderFormSchema.safeParse(example({ items: [emptyItem()] }));
    expect((custom.error?.issues ?? []).map((issue) => issue.path.join('.'))).toEqual([
      'items.0.name',
      'items.0.unitPrice',
    ]);
  });

  it('turns API field paths into form field names', () => {
    expect(formFieldName('items[0].quantity')).toBe('items.0.quantity');
    expect(formFieldName('delivery.addressLine1')).toBe('delivery.addressLine1');
  });
});
