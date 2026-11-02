// Request and response shapes shared by the API and the web app (docs/DEVELOPMENT.md §9).
import type { MemberRole } from './enums.js';

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
