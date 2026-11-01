// Domain enums shared by the API and the web app (docs/DEVELOPMENT.md §7.1, §7.7, §7.9, §8.4).
//
// Each enum is a readonly list of codes plus a union type. The list feeds Zod (`z.enum(ORDER_STATUSES)`)
// and select options; the type is used everywhere else. Codes are stored and sent as-is; display
// labels live in the web app's strings file, never here. The values must match the Prisma enums.

/** Builds a type guard for one of the enum lists below, e.g. for query parameters. */
function guardFor<const T extends readonly string[]>(values: T) {
  const allowed: ReadonlySet<string> = new Set(values);
  return (value: unknown): value is T[number] => typeof value === 'string' && allowed.has(value);
}

/** The seller's own workflow (§7.1). Delivery progress is tracked separately on the delivery. */
export const ORDER_STATUSES = [
  'NEW',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
  'RETURNED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const isOrderStatus = guardFor(ORDER_STATUSES);

/** Calculated from payment records on the server, never set by the client (§7.6). */
export const PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const isPaymentStatus = guardFor(PAYMENT_STATUSES);

/** Only DELIVERY orders have a delivery and therefore a delivery status (§7.1). */
export const DELIVERY_STATUSES = [
  'PENDING',
  'DISPATCHED',
  'DELIVERED',
  'FAILED',
  'RETURNED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const isDeliveryStatus = guardFor(DELIVERY_STATUSES);

/** Cash-on-delivery lifecycle (§7.8). A COD payment exists only once the COD is SETTLED. */
export const COD_STATUSES = ['NOT_APPLICABLE', 'PENDING', 'COLLECTED', 'SETTLED'] as const;
export type CodStatus = (typeof COD_STATUSES)[number];
export const isCodStatus = guardFor(COD_STATUSES);

/** Where the order came from (§7.9). OTHER requires a source note. */
export const SOURCE_CHANNELS = [
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'WHATSAPP',
  'PHONE',
  'WALK_IN',
  'WEBSITE',
  'OTHER',
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];
export const isSourceChannel = guardFor(SOURCE_CHANNELS);

/** DELIVERY is the default; PICKUP orders have no delivery row (§7.9). */
export const FULFILMENT_TYPES = ['DELIVERY', 'PICKUP'] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];
export const isFulfilmentType = guardFor(FULFILMENT_TYPES);

/** How the customer pays, or is expected to pay (§7.7). COD is allowed only for DELIVERY orders. */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'COD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const isPaymentMethod = guardFor(PAYMENT_METHODS);

/** Direction of a payment record; amounts are always positive (§7.7). */
export const PAYMENT_TYPES = ['PAYMENT', 'REFUND'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export const isPaymentType = guardFor(PAYMENT_TYPES);

/** Business membership role. Only OWNER is active in the MVP (§4.2). */
export const MEMBER_ROLES = ['OWNER', 'STAFF'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const isMemberRole = guardFor(MEMBER_ROLES);

/** Entries in an order's activity timeline (§8.2 order_events). */
export const ORDER_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_STATUS_CHANGED',
  'DELIVERY_STATUS_CHANGED',
  'PAYMENT_RECORDED',
  'REFUND_RECORDED',
  'COD_STATUS_CHANGED',
  'NOTE_ADDED',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export const isOrderEventType = guardFor(ORDER_EVENT_TYPES);
