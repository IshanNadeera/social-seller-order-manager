// What can still be changed on an order (docs/DEVELOPMENT.md §7.4). The API refuses locked edits with
// these codes; the order screen uses editableGroups() to disable locked fields.
import type { DeliveryStatus, FulfilmentType, OrderStatus } from './enums.js';

/** Fields that lock together (§7.4). */
export const EDIT_GROUPS = [
  /** Items, quantities, prices, discount, delivery fee. */
  'items',
  /** The order's copy of the delivery address and recipient. */
  'deliveryAddress',
  /** Courier name and tracking number. */
  'courier',
  'notes',
  'sourceChannel',
  'fulfilmentType',
] as const;

export type EditGroup = (typeof EDIT_GROUPS)[number];

export interface EditLockOrder {
  orderStatus: OrderStatus;
  fulfilmentType: FulfilmentType;
  /** null for a pickup order (no delivery row). */
  deliveryStatus: DeliveryStatus | null;
}

/** The seller is still working on the order (§7.4: NEW to READY). */
const OPEN: readonly OrderStatus[] = [
  'NEW',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY',
];
const FINISHED: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED', 'RETURNED'];

/** Not yet handed to the courier: a pickup order, or a delivery still PENDING. */
const notDispatched = (order: EditLockOrder) =>
  order.deliveryStatus === null || order.deliveryStatus === 'PENDING';

/** Which field groups can be edited now (§7.4). */
export function editableGroups(order: EditLockOrder): Record<EditGroup, boolean> {
  const open = OPEN.includes(order.orderStatus);
  const isDelivery = order.fulfilmentType === 'DELIVERY';
  return {
    items: open && notDispatched(order),
    deliveryAddress: isDelivery && open && notDispatched(order),
    courier: isDelivery && order.orderStatus !== 'RETURNED' && order.deliveryStatus !== 'RETURNED',
    notes: true,
    sourceChannel: !FINISHED.includes(order.orderStatus),
    fulfilmentType: open && notDispatched(order),
  };
}

export type EditLockErrorCode =
  | 'ORDER_LOCKED_AFTER_DISPATCH'
  | 'ORDER_CLOSED'
  | 'NOT_A_DELIVERY_ORDER'
  | 'ORDER_TOTAL_BELOW_PAID';

export type EditCheck =
  { ok: true } | { ok: false; code: EditLockErrorCode; group: EditGroup; message: string };

/** For an edit to `items`: the new total, and what the customer has paid so far, net of refunds. */
export interface EditMoney {
  newTotal: string;
  netPaid: string;
}

/**
 * Whether an edit touching `groups` is allowed (§7.4). An edit to `items` must also pass `money`:
 * the new total may not fall below what was already paid (record a refund first).
 */
export function checkOrderEdit(
  order: EditLockOrder,
  groups: readonly EditGroup[],
  money?: EditMoney,
): EditCheck {
  const editable = editableGroups(order);
  for (const group of groups) {
    if (editable[group]) continue;
    if (
      (group === 'deliveryAddress' || group === 'courier') &&
      order.fulfilmentType !== 'DELIVERY'
    ) {
      return {
        ok: false,
        code: 'NOT_A_DELIVERY_ORDER',
        group,
        message: 'This is a pickup order, so it has no delivery details.',
      };
    }
    if (!notDispatched(order)) {
      return {
        ok: false,
        code: 'ORDER_LOCKED_AFTER_DISPATCH',
        group,
        message: 'This order has been sent out, so this can no longer be changed.',
      };
    }
    return {
      ok: false,
      code: 'ORDER_CLOSED',
      group,
      message: 'This order is finished, so this can no longer be changed.',
    };
  }
  if (groups.includes('items')) {
    if (money === undefined) throw new Error('checkOrderEdit: an items edit needs the new total.');
    if (cents(money.newTotal) < cents(money.netPaid)) {
      return {
        ok: false,
        code: 'ORDER_TOTAL_BELOW_PAID',
        group: 'items',
        message:
          'The new total is less than the customer has already paid. Record a refund first, then make this change.',
      };
    }
  }
  return { ok: true };
}

/** An amount such as "1500.00" in whole cents, exactly (no floating point). */
export function cents(amount: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (match === null) throw new Error(`Not an amount: ${amount}`);
  const [, sign = '', whole = '0', fraction = ''] = match;
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign === '-' ? -value : value;
}
