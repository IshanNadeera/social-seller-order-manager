// Request and response shapes shared by the API and the web app (docs/DEVELOPMENT.md §9).
import type {
  CodStatus,
  DeliveryStatus,
  FulfilmentType,
  MemberRole,
  OrderEventType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  SourceChannel,
} from './enums.js';
import type { OrderStage } from './stage.js';

/** GET /api/v1/health (§9.1, §11.7). Reveals no configuration. */
export type HealthResponse =
  { status: 'ok'; database: 'ok' } | { status: 'error'; database: 'unreachable' };

/** The signed-in user's business, as far as the app shell needs it. */
export interface MeBusiness {
  id: string;
  name: string;
  /** 2–6 uppercase letters or digits, e.g. "NIM" for order numbers like NIM-0042. */
  orderPrefix: string;
  currency: string;
  timezone: string;
  /** Pre-fills a new delivery order's fee (§6.4), e.g. "350.00". */
  defaultDeliveryFee: string;
}

/** GET /api/v1/me (§9.1). */
export interface MeResponse {
  user: {
    id: string;
    email: string | null;
  };
  /** True until POST /onboarding has created the user's business. */
  needsOnboarding: boolean;
  /** The user's role in `business`; null while needsOnboarding. */
  role: MemberRole | null;
  business: MeBusiness | null;
}

/**
 * Every API error has this shape (§9.7). `fieldErrors` maps field paths such as
 * "items[0].quantity" to a plain-language message; it is empty when no single field is at fault.
 * Quote `requestId` when reporting a problem: it finds the matching server log line.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
  requestId: string;
}

/** A page of a list (§9.5): items plus where they sit in the full result. */
export interface Page<Item> {
  items: Item[];
  page: number;
  pageSize: number;
  /** Matching rows in total, across all pages. */
  total: number;
}

/** A customer in lists and search results (§6.6). Dates are ISO 8601 strings in UTC. */
export interface CustomerSummary {
  id: string;
  name: string;
  /** The phone as the seller typed it. */
  phone: string | null;
  /** E.164 (+94771234567), or null when there is no phone or it could not be read. */
  phoneE164: string | null;
  /** 'PHONE_UNREADABLE' when a phone was saved but could not be read (§7.11): show a warning. */
  phoneWarning: 'PHONE_UNREADABLE' | null;
  email: string | null;
  archivedAt: string | null;
  orderCount: number;
  lastOrderAt: string | null;
}

/** A saved delivery address (§7.11). */
export interface CustomerAddressView {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  isDefault: boolean;
}

/** GET /customers/:id. Active addresses only, the default first. */
export interface CustomerDetail extends CustomerSummary {
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  addresses: CustomerAddressView[];
}

/** A product (GET /products, GET /products/:id, §9.3). Money is a string with two decimals (§7.5). */
export interface ProductView {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  /** e.g. "1500.00" */
  sellingPrice: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An order line (§8.2 order_items): names, SKU and price are copies taken when it was saved. */
export interface OrderItemView {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

/** The order's own copy of the delivery details (§8.2 deliveries). */
export interface OrderDeliveryView {
  status: DeliveryStatus;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  codAmount: string;
  codStatus: CodStatus;
}

/** POST /orders and GET /orders/:id (§9.4). Money as strings with two decimals (§7.5). */
export interface OrderDetail {
  id: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Derived display stage (§7.3). */
  stage: OrderStage;
  sourceChannel: SourceChannel;
  sourceNote: string | null;
  fulfilmentType: FulfilmentType;
  paymentMethod: PaymentMethod;
  customer: { id: string | null; name: string; phone: string | null };
  items: OrderItemView[];
  subtotal: string;
  discountAmount: string;
  deliveryFee: string;
  totalAmount: string;
  amountPaid: string;
  amountRefunded: string;
  balanceDue: string;
  refundOwed: string;
  delivery: OrderDeliveryView | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row of GET /orders (§6.3). The phone is masked on the list ("077 ••• 4567"). */
export interface OrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhoneMasked: string | null;
  totalAmount: string;
  balanceDue: string;
  stage: OrderStage;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus | null;
  sourceChannel: SourceChannel;
  fulfilmentType: FulfilmentType;
}

/** One entry of an order's activity history (GET /orders/:id/events, §8.2 order_events). */
export interface OrderEventView {
  id: string;
  type: OrderEventType;
  /** Who did it; null for automatic changes. */
  actor: { id: string; name: string } | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}

/** One payment or refund record (GET /orders/:id/payments, §7.7). Records are never changed. */
export interface PaymentView {
  id: string;
  type: PaymentType;
  method: PaymentMethod;
  /** Always positive; `type` gives the direction. */
  amount: string;
  /** When the money changed hands (may be backdated up to 90 days). */
  occurredAt: string;
  /** When it was recorded. */
  createdAt: string;
  refundOfPaymentId: string | null;
  reference: string | null;
  notes: string | null;
  recordedBy: { id: string; name: string };
}

/** A row of GET /cod/awaiting: a delivered COD order whose money is still with the courier. */
export interface CodAwaitingItem {
  orderId: string;
  orderNumber: string;
  recipientName: string;
  courierName: string | null;
  trackingNumber: string | null;
  codAmount: string;
  deliveredAt: string | null;
}

/** POST /cod/settle: one COD payment per order, and their sum. */
export interface CodBulkSettled {
  settled: { orderId: string; orderNumber: string; paymentId: string; amount: string }[];
  totalAmount: string;
}

/** POST /orders/:id/payments: the new record and the order with its recalculated summary. */
export interface PaymentRecorded {
  payment: PaymentView;
  order: OrderDetail;
}

/**
 * GET /dashboard/summary (§6.2, §15). Money is a decimal string. Order value, money received and
 * COD still with couriers are separate figures and must never be added together (§6.2): a
 * delivered COD order is not money received until it is settled.
 */
export interface DashboardSummary {
  /** The business timezone every date here is in. */
  timeZone: string;
  /** Today, on the business's clock. */
  today: { date: string; ordersCreated: number };
  /** The state right now, whatever the period. */
  now: {
    ordersNeedingAction: number;
    readyToSend: number;
    outForDelivery: number;
    /** What customers still owe on open and completed orders (COD not yet settled included). */
    outstandingBalance: string;
    /** COD on parcels the courier is carrying now. */
    codOutForDelivery: string;
    /** COD couriers have collected and not yet paid over. */
    codWithCourier: string;
    /** Money still held on cancelled and returned orders. */
    refundsOwed: string;
  };
  /** The chosen local dates, both included. */
  period: {
    from: string;
    to: string;
    ordersCreated: number;
    cancelled: number;
    /** Cancelled ÷ created, of the orders created in the period; null when none were created. */
    cancellationRate: number | null;
    delivered: number;
    /** Total of the orders created in the period, cancelled ones left out. Not revenue. */
    orderValue: string;
    paymentsReceived: string;
    refunds: string;
    netReceived: string;
  };
}

/**
 * GET /reports/sales (§9.4, §2.2): a period's sales, by the §15 definitions. Money is a decimal
 * string. "Order value" is what orders were worth, not money received.
 */
export interface SalesReport {
  timeZone: string;
  from: string;
  to: string;
  totals: {
    ordersCreated: number;
    cancelled: number;
    /** Total of the orders created in the period, cancelled ones left out. Not revenue. */
    orderValue: string;
    /** Order value ÷ orders not cancelled; null when there were none. */
    averageOrderValue: string | null;
    paymentsReceived: string;
    refunds: string;
    netReceived: string;
  };
  /** Days with any orders or money, oldest first (local dates). */
  byDay: { date: string; ordersCreated: number; orderValue: string; netReceived: string }[];
  /** Orders not cancelled, by where they came from; largest order value first. */
  bySource: { sourceChannel: SourceChannel; orders: number; orderValue: string }[];
  /** The ten items with the largest value on orders not cancelled. */
  topItems: { name: string; sku: string | null; quantity: number; value: string }[];
}
