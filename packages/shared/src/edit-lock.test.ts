// §7.4 edit rules. The expected table is written out here from the blueprint and checked for every
// order status × delivery status (and pickup).
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_STATUSES,
  ORDER_STATUSES,
  cents,
  checkOrderEdit,
  editableGroups,
} from './index.js';
import type { DeliveryStatus, EditLockOrder, OrderStatus } from './index.js';

const OPEN = new Set<OrderStatus>([
  'NEW',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY',
]);
const FINISHED = new Set<OrderStatus>(['COMPLETED', 'CANCELLED', 'RETURNED']);
const BEFORE_DISPATCH = (d: DeliveryStatus | null) => d === null || d === 'PENDING';

const delivery = (orderStatus: OrderStatus, deliveryStatus: DeliveryStatus): EditLockOrder => ({
  orderStatus,
  fulfilmentType: 'DELIVERY',
  deliveryStatus,
});
const pickup = (orderStatus: OrderStatus): EditLockOrder => ({
  orderStatus,
  fulfilmentType: 'PICKUP',
  deliveryStatus: null,
});

const ALL_ORDERS: EditLockOrder[] = ORDER_STATUSES.flatMap((status) => [
  pickup(status),
  ...DELIVERY_STATUSES.map((d) => delivery(status, d)),
]);

describe('editableGroups: the §7.4 table, for every status pair', () => {
  it.each(
    ALL_ORDERS.map(
      (order) => [order.orderStatus, order.deliveryStatus ?? 'pickup', order] as const,
    ),
  )('order %s, delivery %s', (_status, _delivery, order) => {
    const open = OPEN.has(order.orderStatus) && BEFORE_DISPATCH(order.deliveryStatus);
    const isDelivery = order.fulfilmentType === 'DELIVERY';
    expect(editableGroups(order)).toEqual({
      items: open,
      deliveryAddress: isDelivery && open,
      courier:
        isDelivery && order.orderStatus !== 'RETURNED' && order.deliveryStatus !== 'RETURNED',
      notes: true,
      sourceChannel: !FINISHED.has(order.orderStatus),
      fulfilmentType: open,
    });
  });

  it('spot checks', () => {
    expect(editableGroups(delivery('READY', 'DISPATCHED'))).toEqual({
      items: false,
      deliveryAddress: false,
      courier: true,
      notes: true,
      sourceChannel: true,
      fulfilmentType: false,
    });
    expect(editableGroups(pickup('COMPLETED'))).toEqual({
      items: false,
      deliveryAddress: false,
      courier: false,
      notes: true,
      sourceChannel: false,
      fulfilmentType: false,
    });
  });
});

describe('checkOrderEdit', () => {
  const paid = (newTotal: string, netPaid: string) => ({ newTotal, netPaid });

  it('allows an items edit before dispatch when the total still covers what was paid', () => {
    expect(
      checkOrderEdit(delivery('READY', 'PENDING'), ['items'], paid('1000.00', '1000.00')),
    ).toEqual({
      ok: true,
    });
    expect(checkOrderEdit(pickup('NEW'), ['items', 'notes'], paid('0.00', '0.00'))).toEqual({
      ok: true,
    });
  });

  it('ORDER_TOTAL_BELOW_PAID when the new total is below the net amount paid', () => {
    expect(checkOrderEdit(pickup('CONFIRMED'), ['items'], paid('999.99', '1000.00'))).toMatchObject(
      {
        ok: false,
        code: 'ORDER_TOTAL_BELOW_PAID',
        group: 'items',
      },
    );
  });

  it.each(['DISPATCHED', 'DELIVERED', 'FAILED', 'RETURNED'] as const)(
    'ORDER_LOCKED_AFTER_DISPATCH for items, address and fulfilment once the delivery is %s',
    (deliveryStatus) => {
      for (const group of ['items', 'deliveryAddress', 'fulfilmentType'] as const) {
        expect(
          checkOrderEdit(delivery('READY', deliveryStatus), [group], paid('1', '0')),
        ).toMatchObject({ ok: false, code: 'ORDER_LOCKED_AFTER_DISPATCH', group });
      }
    },
  );

  it('ORDER_CLOSED for a finished order that was never dispatched', () => {
    expect(checkOrderEdit(pickup('COMPLETED'), ['items'], paid('1', '0'))).toMatchObject({
      code: 'ORDER_CLOSED',
    });
    expect(checkOrderEdit(delivery('CANCELLED', 'PENDING'), ['sourceChannel'])).toMatchObject({
      code: 'ORDER_CLOSED',
      group: 'sourceChannel',
    });
  });

  it('NOT_A_DELIVERY_ORDER for delivery details on a pickup order', () => {
    expect(checkOrderEdit(pickup('NEW'), ['courier'])).toMatchObject({
      code: 'NOT_A_DELIVERY_ORDER',
    });
    expect(checkOrderEdit(pickup('NEW'), ['deliveryAddress'])).toMatchObject({
      code: 'NOT_A_DELIVERY_ORDER',
    });
  });

  it('courier details stay editable until returned; notes always', () => {
    expect(checkOrderEdit(delivery('COMPLETED', 'DELIVERED'), ['courier', 'notes'])).toEqual({
      ok: true,
    });
    expect(checkOrderEdit(delivery('RETURNED', 'RETURNED'), ['courier'])).toMatchObject({
      code: 'ORDER_LOCKED_AFTER_DISPATCH',
    });
    expect(checkOrderEdit(delivery('RETURNED', 'RETURNED'), ['notes'])).toEqual({ ok: true });
  });

  it('reports the first locked group and checks money only when everything is editable', () => {
    expect(
      checkOrderEdit(delivery('READY', 'DISPATCHED'), ['notes', 'items'], paid('0', '500')),
    ).toMatchObject({ code: 'ORDER_LOCKED_AFTER_DISPATCH', group: 'items' });
  });

  it('needs the money for an items edit (a programming error otherwise)', () => {
    expect(() => checkOrderEdit(pickup('NEW'), ['items'])).toThrow(/needs the new total/);
  });
});

describe('cents', () => {
  it.each([
    ['1500.00', 150000n],
    ['0.5', 50n],
    ['7', 700n],
    ['-2.25', -225n],
    ['99999999.99', 9999999999n],
  ] as const)('%s → %s', (amount, expected) => {
    expect(cents(amount)).toBe(expected);
  });

  it('refuses anything else', () => {
    expect(() => cents('1.234')).toThrow();
    expect(() => cents('abc')).toThrow();
  });
});
