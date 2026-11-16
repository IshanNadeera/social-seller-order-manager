// The copyable customer messages (docs/DEVELOPMENT.md §2.1, §6.5). Fake data only.
import type { OrderDeliveryView, OrderDetail } from '@ssom/shared';
import { describe, expect, it } from 'vitest';
import { messageTemplates } from './message-templates';

const CONTEXT = { businessName: 'Nimali Fashions', currency: 'LKR' };

function delivery(overrides: Partial<OrderDeliveryView> = {}): OrderDeliveryView {
  return {
    status: 'PENDING',
    recipientName: 'Nimali Demo',
    phone: '0771234567',
    addressLine1: '12 Lake Road',
    addressLine2: null,
    city: 'Kandy',
    district: 'Kandy',
    postalCode: null,
    courierName: null,
    trackingNumber: null,
    codAmount: '2450.00',
    codStatus: 'PENDING',
    ...overrides,
  };
}

/** A CONFIRMED COD delivery for a saved customer: 2 sarees + delivery = 2450.00, nothing paid. */
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    orderNumber: 'NIM-0042',
    orderStatus: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    stage: 'CONFIRMED',
    sourceChannel: 'WHATSAPP',
    sourceNote: null,
    fulfilmentType: 'DELIVERY',
    paymentMethod: 'COD',
    customer: { id: 'c1', name: 'Kamala Perera', phone: '0771234567' },
    items: [
      {
        id: 'i1',
        productId: null,
        name: 'Silk Saree',
        sku: null,
        quantity: 2,
        unitPrice: '1050.00',
        lineTotal: '2100.00',
      },
    ],
    subtotal: '2100.00',
    discountAmount: '0.00',
    deliveryFee: '350.00',
    totalAmount: '2450.00',
    amountPaid: '0.00',
    amountRefunded: '0.00',
    balanceDue: '2450.00',
    refundOwed: '0.00',
    delivery: delivery(),
    notes: 'Private: ask about the blue one',
    createdAt: '2026-11-01T06:00:00.000Z',
    updatedAt: '2026-11-01T06:00:00.000Z',
    ...overrides,
  };
}

const ids = (detail: OrderDetail) =>
  messageTemplates(detail, CONTEXT).map((template) => template.id);
const text = (detail: OrderDetail, id: string) =>
  messageTemplates(detail, CONTEXT).find((template) => template.id === id)?.text;

describe('message templates (§2.1, §6.5)', () => {
  it('fills the confirmation with customer, items, total, COD and address, and no private notes', () => {
    expect(text(order(), 'confirmation')).toBe(
      [
        'Hi Kamala Perera,',
        'Thank you for your order NIM-0042 from Nimali Fashions.',
        '',
        '• 2 × Silk Saree: LKR 2,100.00',
        '',
        'Total: LKR 2,450.00',
        'Please pay LKR 2,450.00 in cash on delivery.',
        'We’ll deliver to Nimali Demo, 12 Lake Road, Kandy, Kandy.',
      ].join('\n'),
    );
    // COD is collected by the courier: no payment reminder.
    expect(ids(order())).toEqual(['confirmation']);
    const delivered = order({
      orderStatus: 'COMPLETED',
      stage: 'COMPLETED',
      delivery: delivery({ status: 'DELIVERED', codStatus: 'COLLECTED' }),
    });
    expect(ids(delivered)).toEqual(['confirmation']);
  });

  it('a bank-transfer pickup with a balance gets a reminder; ready, it gets a collection message', () => {
    const pickup = order({
      fulfilmentType: 'PICKUP',
      paymentMethod: 'BANK_TRANSFER',
      delivery: null,
      deliveryFee: '0.00',
      totalAmount: '2100.00',
      amountPaid: '1000.00',
      balanceDue: '1100.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(text(pickup, 'confirmation')).toContain('Balance to pay: LKR 1,100.00');
    expect(text(pickup, 'confirmation')).toContain(
      'We’ll let you know when it’s ready to collect.',
    );
    expect(text(pickup, 'paymentReminder')).toBe(
      [
        'Hi Kamala Perera,',
        'A friendly reminder that LKR 1,100.00 is still to be paid for your order NIM-0042.',
        'Thank you, Nimali Fashions',
      ].join('\n'),
    );
    const ready = { ...pickup, orderStatus: 'READY' as const, stage: 'READY_FOR_PICKUP' as const };
    expect(ids(ready)).toEqual(['confirmation', 'paymentReminder', 'readyForPickup']);
    expect(text(ready, 'readyForPickup')).toContain(
      'Balance to pay when you collect: LKR 1,100.00',
    );
    // Collected but not fully paid: the reminder stays.
    expect(ids({ ...pickup, orderStatus: 'COMPLETED', stage: 'COMPLETED' })).toEqual([
      'confirmation',
      'paymentReminder',
    ]);
  });

  it('a dispatched order gets courier, tracking and the COD to keep ready', () => {
    const sent = order({
      orderStatus: 'READY',
      stage: 'OUT_FOR_DELIVERY',
      delivery: delivery({
        status: 'DISPATCHED',
        courierName: 'Koombiyo',
        trackingNumber: 'KB123',
      }),
    });
    expect(text(sent, 'dispatched')).toBe(
      [
        'Hi Kamala Perera,',
        'Your order NIM-0042 is on its way!',
        'Courier: Koombiyo',
        'Tracking number: KB123',
        'Please keep LKR 2,450.00 ready to pay on delivery.',
        'Thank you, Nimali Fashions',
      ].join('\n'),
    );
    // Unknown courier details are left out rather than shown blank.
    const bare = order({ orderStatus: 'READY', delivery: delivery({ status: 'DISPATCHED' }) });
    expect(text(bare, 'dispatched')).not.toContain('Courier');
  });

  it('a paid walk-in greets the recipient or nobody; closed orders get no messages', () => {
    const paid = order({
      customer: { id: null, name: 'Walk-in customer', phone: null },
      paymentMethod: 'CASH',
      fulfilmentType: 'PICKUP',
      delivery: null,
      amountPaid: '2450.00',
      balanceDue: '0.00',
      paymentStatus: 'PAID',
    });
    expect(text(paid, 'confirmation')?.startsWith('Hi,\n')).toBe(true);
    expect(text(paid, 'confirmation')).toContain('Paid in full. Thank you!');
    expect(ids(paid)).toEqual(['confirmation']);
    expect(ids(order({ orderStatus: 'CANCELLED', stage: 'CANCELLED' }))).toEqual([]);
    expect(ids(order({ orderStatus: 'RETURNED', stage: 'RETURNED' }))).toEqual([]);
  });
});
