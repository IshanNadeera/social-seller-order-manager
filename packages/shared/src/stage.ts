// The display stage (docs/DEVELOPMENT.md §7.3): one simple label derived from the stored order and
// delivery statuses. Never stored. Used by the web app and the CSV export, so both say the same.
import type { DeliveryStatus, OrderStatus } from './enums.js';

export const ORDER_STAGES = [
  'NEW',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_TO_SEND',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
  'COMPLETED',
  'CANCELLED',
  'RETURNED',
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/**
 * English labels from §7.3, for the CSV export. The web app shows its own copy from strings.ts
 * (typed by OrderStage), so it can be translated.
 */
export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  NEW: 'New',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_TO_SEND: 'Ready to send',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_FAILED: 'Delivery failed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
};

/**
 * The stage for an order. `deliveryStatus` is null for a PICKUP order (it has no delivery row).
 * Only READY looks at the delivery status (§7.3). Pairs the workflow cannot produce (READY with a
 * DELIVERED or RETURNED delivery: those move the order to COMPLETED / RETURNED in the same
 * transaction, §7.2) fall back to the order status alone, so a screen never breaks on them.
 */
export function orderStage(
  orderStatus: OrderStatus,
  deliveryStatus: DeliveryStatus | null,
): OrderStage {
  switch (orderStatus) {
    case 'NEW':
      return 'NEW';
    case 'PENDING_CONFIRMATION':
      return 'AWAITING_CONFIRMATION';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY':
      if (deliveryStatus === null) return 'READY_FOR_PICKUP';
      if (deliveryStatus === 'DISPATCHED') return 'OUT_FOR_DELIVERY';
      if (deliveryStatus === 'FAILED') return 'DELIVERY_FAILED';
      return 'READY_TO_SEND';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'RETURNED':
      return 'RETURNED';
  }
}
