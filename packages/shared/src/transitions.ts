// Status transition tables (docs/DEVELOPMENT.md §7.2), as data with validators. The API checks every
// change with these; the web app uses them to show only the actions that are allowed (§6.5).
import type {
  CodStatus,
  DeliveryStatus,
  FulfilmentType,
  MemberRole,
  OrderStatus,
} from './enums.js';

// ---------- Order status: seller actions ----------

export interface OrderTransitionRule {
  to: OrderStatus;
  /** Only for orders with this fulfilment type (delivery orders complete through delivery events). */
  fulfilment?: FulfilmentType;
  /** Only while the delivery has not been dispatched (no delivery, or delivery PENDING). */
  notDispatched?: true;
  reasonRequired?: true;
  /** An owner correction. */
  ownerOnly?: true;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderTransitionRule[]> = {
  NEW: [
    { to: 'PENDING_CONFIRMATION' },
    { to: 'CONFIRMED' },
    { to: 'CANCELLED', reasonRequired: true },
  ],
  PENDING_CONFIRMATION: [{ to: 'CONFIRMED' }, { to: 'CANCELLED', reasonRequired: true }],
  // Skipping PREPARING is allowed.
  CONFIRMED: [
    { to: 'PREPARING' },
    { to: 'READY' },
    { to: 'CANCELLED', reasonRequired: true },
  ],
  PREPARING: [{ to: 'READY' }, { to: 'CANCELLED', reasonRequired: true }],
  READY: [
    { to: 'COMPLETED', fulfilment: 'PICKUP' },
    { to: 'CANCELLED', notDispatched: true, reasonRequired: true },
  ],
  // Delivery orders are returned through the delivery action, so both statuses change together.
  COMPLETED: [{ to: 'RETURNED', fulfilment: 'PICKUP', reasonRequired: true, ownerOnly: true }],
  CANCELLED: [],
  RETURNED: [],
};

export interface OrderTransitionContext {
  fulfilmentType: FulfilmentType;
  /** null for a pickup order (no delivery row). */
  deliveryStatus: DeliveryStatus | null;
  role: MemberRole;
  /** The reason the seller gave, if any. */
  reason?: string | null;
}

export type TransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'REASON_REQUIRED'
  | 'ORDER_DISPATCHED'
  | 'OWNER_ONLY';

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: TransitionErrorCode; message: string };

const OK: TransitionCheck = { ok: true };
const refuse = (code: TransitionErrorCode, message: string): TransitionCheck => ({
  ok: false,
  code,
  message,
});

const hasReason = (reason: string | null | undefined) => (reason ?? '').trim() !== '';

/** Whether the seller may move an order `from` → `to` (§7.2), and why not. */
export function checkOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: OrderTransitionContext,
): TransitionCheck {
  const rule = ORDER_TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (rule === undefined || (rule.fulfilment && rule.fulfilment !== context.fulfilmentType)) {
    return refuse('INVALID_TRANSITION', 'This order can’t be moved to that status from where it is now.');
  }
  if (rule.notDispatched && context.deliveryStatus !== null && context.deliveryStatus !== 'PENDING') {
    return refuse(
      'ORDER_DISPATCHED',
      'This order has already been sent out, so it can’t be cancelled. Record the delivery result instead.',
    );
  }
  if (rule.ownerOnly && context.role !== 'OWNER') {
    return refuse('OWNER_ONLY', 'Only the business owner can make this correction.');
  }
  if (rule.reasonRequired && !hasReason(context.reason)) {
    return refuse('REASON_REQUIRED', 'Please give a reason.');
  }
  return OK;
}

/**
 * The statuses the seller can move the order to now, for showing action buttons. Ignores the reason
 * (the form asks for it) but applies fulfilment, dispatch and role rules.
 */
export function allowedOrderTransitions(
  from: OrderStatus,
  context: Omit<OrderTransitionContext, 'reason'>,
): OrderStatus[] {
  return ORDER_TRANSITIONS[from]
    .filter((rule) => checkOrderTransition(from, rule.to, { ...context, reason: 'shown' }).ok)
    .map((rule) => rule.to);
}

// ---------- Delivery status ----------

export interface DeliveryTransitionRule {
  to: DeliveryStatus;
  /** The order must have this status (dispatch needs a READY order). */
  orderMustBe?: OrderStatus;
  reasonRequired?: true;
  ownerOnly?: true;
  /** What the order becomes in the same transaction. */
  orderBecomes?: OrderStatus;
  /** Sets dispatched_at, adds 1 to attempt_count and freezes cod_amount. */
  dispatch?: true;
}

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryTransitionRule[]> = {
  PENDING: [{ to: 'DISPATCHED', orderMustBe: 'READY', dispatch: true }],
  DISPATCHED: [
    { to: 'DELIVERED', orderBecomes: 'COMPLETED' },
    // failed_reason is required.
    { to: 'FAILED', reasonRequired: true },
  ],
  FAILED: [
    // A re-attempt.
    { to: 'DISPATCHED', orderMustBe: 'READY', dispatch: true },
    { to: 'RETURNED', orderBecomes: 'RETURNED' },
  ],
  // Owner correction. If money was received, the order shows under "Refunds owed" until refunded.
  DELIVERED: [{ to: 'RETURNED', orderBecomes: 'RETURNED', reasonRequired: true, ownerOnly: true }],
  RETURNED: [],
};

export interface DeliveryTransitionContext {
  orderStatus: OrderStatus;
  role: MemberRole;
  reason?: string | null;
}

/** Whether a delivery may move `from` → `to` (§7.2), and why not. */
export function checkDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  context: DeliveryTransitionContext,
): TransitionCheck {
  const rule = DELIVERY_TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (rule === undefined) {
    return refuse('INVALID_TRANSITION', 'This delivery can’t be moved to that status from where it is now.');
  }
  if (rule.orderMustBe !== undefined && context.orderStatus !== rule.orderMustBe) {
    return refuse('INVALID_TRANSITION', 'Mark the order as ready before sending it out.');
  }
  if (rule.ownerOnly && context.role !== 'OWNER') {
    return refuse('OWNER_ONLY', 'Only the business owner can make this correction.');
  }
  if (rule.reasonRequired && !hasReason(context.reason)) {
    return refuse('REASON_REQUIRED', 'Please give a reason.');
  }
  return OK;
}

/** The delivery statuses that can follow `from` now, for action buttons (reason asked by the form). */
export function allowedDeliveryTransitions(
  from: DeliveryStatus,
  context: Omit<DeliveryTransitionContext, 'reason'>,
): DeliveryStatus[] {
  return DELIVERY_TRANSITIONS[from]
    .filter((rule) => checkDeliveryTransition(from, rule.to, { ...context, reason: 'shown' }).ok)
    .map((rule) => rule.to);
}

// ---------- COD status ----------

/** What causes a COD status change (§7.2). The seller never sets a COD status directly. */
export type CodTrigger =
  /** The order is saved with payment method COD and cod_amount > 0. */
  | 'ORDER_SAVED_AS_COD'
  /** The delivery is marked DELIVERED: the courier has the money. */
  | 'DELIVERED'
  /** The seller marks the COD as settled (a PAYMENT is created). */
  | 'SETTLED'
  /** The order is cancelled or returned before settlement. */
  | 'ORDER_CANCELLED_OR_RETURNED';

export interface CodTransitionRule {
  to: CodStatus;
  trigger: CodTrigger;
}

export const COD_TRANSITIONS: Record<CodStatus, readonly CodTransitionRule[]> = {
  NOT_APPLICABLE: [{ to: 'PENDING', trigger: 'ORDER_SAVED_AS_COD' }],
  PENDING: [
    { to: 'COLLECTED', trigger: 'DELIVERED' },
    { to: 'NOT_APPLICABLE', trigger: 'ORDER_CANCELLED_OR_RETURNED' },
  ],
  COLLECTED: [
    { to: 'SETTLED', trigger: 'SETTLED' },
    { to: 'NOT_APPLICABLE', trigger: 'ORDER_CANCELLED_OR_RETURNED' },
  ],
  // Settled money stays settled; a return after settlement is handled with a refund (§7.7).
  SETTLED: [],
};

/** The COD status after `trigger`, or null when the trigger changes nothing from `from`. */
export function nextCodStatus(from: CodStatus, trigger: CodTrigger): CodStatus | null {
  return COD_TRANSITIONS[from].find((rule) => rule.trigger === trigger)?.to ?? null;
}

/** Whether COD may move `from` → `to` at all (§7.2). */
export function isCodTransitionAllowed(from: CodStatus, to: CodStatus): boolean {
  return COD_TRANSITIONS[from].some((rule) => rule.to === to);
}
