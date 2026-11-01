# Social Seller Order Manager
## Detailed Development Specification and Implementation Blueprint

**Document version:** 1.1
**Prepared:** 29 October 2026 · **Revised:** 1 November 2026
**Product type:** Multi-tenant SaaS web application
**Initial market:** Sri Lanka
**Target customers:** All small online sellers
**Initial order intake:** Manual entry from any channel
**Initial client:** Responsive web application
**Platform decisions:** Supabase (PostgreSQL + Auth), npm workspaces, NestJS + Prisma API
**Status:** Development baseline; validate business assumptions with pilot users before treating them as proven.

---

## 0. What Changed in Version 1.1

Version 1.0 left several conflicts and open decisions. Version 1.1 resolves them. Each one is recorded as an Architecture Decision Record (ADR) in Section 21.

| # | Gap in v1.0 | Resolution in v1.1 |
|---|---|---|
| 1 | Order status and delivery status both contained `DISPATCHED`, `DELIVERED`, `FAILED_DELIVERY`, `RETURNED`; delivery status was stored on both `orders` and `deliveries`. | Order status now covers only the seller's workflow. Delivery status lives **only** on `deliveries`. Delivery events drive the order to `COMPLETED` or `RETURNED` automatically. The UI shows a derived "stage" label (Section 7.3). |
| 2 | Payment status: stored or derived was undecided. | **Stored**, but always recalculated from payment records inside the same transaction, by one function. Never incremented (Section 7.6). |
| 3 | No defined way for COD to become money received. | Added `cod_status` (`NOT_APPLICABLE → PENDING → COLLECTED → SETTLED`). A `PAYMENT` record is created only when the seller marks the COD as settled (Section 7.8). |
| 4 | Both line-level and order-level discounts appeared. | **Order-level fixed-amount discount only.** `line_discount` removed (Section 7.5). |
| 5 | `customer_id` optional but customer name snapshot required. | Customer required for every order **except** anonymous `WALK_IN` sales, which store the snapshot name "Walk-in customer" (Section 7.10). |
| 6 | Prisma example used strings instead of enums; no cross-tenant protection in the database. | Full Prisma schema with enums and composite foreign keys `(business_id, id)` (Section 8.4). |
| 7 | Order number prefix `SS-` was the same for every business. | Each business has its own `order_prefix`. Format `{PREFIX}-{0001}`, no annual reset (Section 7.12). |
| 8 | Database and package manager undecided. | **Supabase** for PostgreSQL and authentication; **npm workspaces**. |
| 9 | Authentication approach undecided. | **Supabase Auth** in the browser; the NestJS API verifies the Supabase access token. The API does not handle passwords (Section 11.2). |
| 10 | Supabase exposes tables through its auto-generated Data API. | Application tables live in a private `app` schema that is not exposed, and RLS is enabled with no policies as a second layer (Section 11.3). |
| 11 | No fulfilment type for orders that don't need delivery. | Added `fulfilment_type` (`DELIVERY` or `PICKUP`). A `deliveries` row exists only for `DELIVERY` orders. |
| 12 | Double-submission on weak mobile networks. | `Idempotency-Key` header required on order creation and payment recording (Section 9.8). |
| 13 | Prisma version and connection setup unspecified. | Targets **Prisma 7**: URLs in `prisma.config.ts`, runtime via `@prisma/adapter-pg`, explicit `app` schema. Schema checked with Prisma's validator (Section 8.4). |

---

## 1. Purpose of This Document

This document is the working source of truth for designing, building, testing, deploying, and launching Social Seller Order Manager. Use it to break work into issues and pull requests. Update this document when an approved product or technical decision changes, and add an ADR entry in Section 21.

The product should help small sellers manage orders received through Facebook, TikTok, Instagram, WhatsApp, phone calls, walk-ins, websites, and other sources in one place. The first release records orders manually; automatic import and messaging integrations are explicitly out of scope.

### 1.1 Product promise

> Never lose track of an order again.

### 1.2 Important assumptions

The following are hypotheses, not validated facts:

- Sellers experience enough order-management pain to adopt a separate tool.
- Sellers will enter orders manually if the workflow is fast enough.
- A useful portion of the target market will pay a monthly subscription.
- Initial pricing around LKR 990–1,990/month may be acceptable to some sellers.
- A responsive web app is sufficient for the initial launch.

Validate these with interviews, a prototype, and a pilot before investing heavily.

### 1.3 Product principles

1. Mobile-first and simple for non-technical sellers.
2. Fast order entry is the main workflow.
3. Order status, payment status, and delivery status are separate concepts, and each fact is stored in exactly one place.
4. Historical orders must not change when catalogue or customer data changes.
5. Each business's data must be isolated from every other business.
6. Financial totals are calculated and validated on the server.
7. Expected money (COD) is never treated as received money.
8. Keep the first release small; avoid premature integrations.
9. Make data export and recovery possible.
10. Treat privacy, backups, and access control as launch requirements, not future enhancements.

---

## 2. Scope and Release Boundaries

### 2.1 MVP — must have

- User sign-up, login, logout, email verification, and password reset (Supabase Auth).
- Onboarding that creates the initial business workspace.
- Business profile, order prefix, default currency, timezone, and preferences.
- Customer list, create, edit, search, and archive.
- Customer delivery addresses.
- Product list, create, edit, search, and archive.
- Create, view, search, filter, edit, and cancel orders.
- Manually select the order's source channel and fulfilment type (delivery or pickup).
- Order items with quantity and price snapshots.
- Subtotal, order discount, delivery fee, and total calculation.
- Payment records including partial payments and refunds.
- Payment status and outstanding balance.
- Delivery details, courier name, tracking number, COD amount, delivery status, and COD settlement.
- Status/event history.
- Dashboard with operational summaries.
- Basic date/status/source filters and CSV export.
- Responsive layout for mobile, tablet, and desktop.
- Server-side validation, tenant isolation, automated tests, deployment, backups, and error logging.
- Copyable customer message templates; no automated message sending.

### 2.2 Should have if time permits

- Quick-add customer and product from the order form.
- Duplicate-order warning (same customer phone, similar total, within 30 minutes).
- Bulk "mark COD settled" for several orders from the same courier remittance.
- Basic sales summary report.
- Keyboard-friendly desktop workflow.
- Empty/loading/error states and onboarding hints.

### 2.3 Explicitly out of scope for MVP

- Automatic import from Facebook, Instagram, TikTok, or WhatsApp.
- Reading social media inboxes or comments.
- Automated WhatsApp messages or bots.
- Courier API integrations and live tracking.
- Courier fee and remittance-deduction accounting.
- Online payment gateway and recurring billing automation.
- Inventory management and stock reservation.
- Accounting, tax filing, payroll, or invoicing compliance.
- Native iOS or Android applications.
- Advanced multi-branch inventory.
- Complex staff permission matrix (only `OWNER` is active in MVP).
- Social login (Google/Facebook) — can be added later through Supabase Auth.
- AI features.
- Marketplace storefront.
- Offline-first synchronization.

Do not add out-of-scope items without evidence from users and an explicit product decision.

---

## 3. Validation and Product Discovery

### 3.1 Before implementation

Interview 10–15 small online sellers across several categories: clothing, gifts, beauty products, food, crafts, and general reselling. Ask about actual recent workflows, not only hypothetical interest.

Questions:
- Where do orders arrive today?
- How are orders recorded and assigned?
- How many orders do you handle in a normal week?
- How do you track payment, COD, dispatch, delivery, and returns?
- How and how often do couriers remit COD money to you? Do they deduct fees?
- What mistakes happen most often?
- What do you use today: notebook, spreadsheet, chat labels, or another tool?
- Which part takes the most time?
- What would stop you from entering each order into a separate app?
- What would make this worth paying for?
- Can you try a prototype with a few real orders?

Do not collect or retain customer personal data during interviews unless needed and explicitly permitted.

### 3.2 Suggested validation thresholds

These are decision thresholds, not market findings:
- Interview at least 10 sellers.
- At least 7 describe recurring order-management problems.
- Recruit 3–5 pilot sellers.
- At least 3 pilot sellers actively use it each week.
- At least 80% of pilot orders can be entered without developer assistance.
- At least 2 pilot sellers demonstrate credible willingness to pay at the proposed entry price.
- Most standard orders can be entered in under two minutes.

If sellers refuse manual entry, identify the reason before building integrations. If the main problem is social inbox consolidation, the current MVP premise may need revision.

### 3.3 Pilot measures

Track:
- Time to first order.
- Orders created per active seller per week.
- Order-entry completion time.
- Weekly active sellers.
- Number of corrections and reported missed orders.
- Support time per seller.
- Paid conversion and cancellation reasons.
- Hosting cost per active seller.

Do not claim error reduction unless baseline and pilot data support it.

---

## 4. Personas and User Roles

### 4.1 Primary persona

A small seller who receives orders through social channels and wants an easy way to record customer details, products, payments, and delivery progress from a phone.

### 4.2 Roles

**Business owner (`OWNER`)**
- Owns the business workspace.
- Can manage business settings and all business records.
- Can export and request deletion of business data.
- Can perform audited corrections (e.g. reverse a `COMPLETED` order to `RETURNED`).

**Staff member (`STAFF`) — designed, not enabled in MVP**
- Can create and update orders within an assigned business.
- Cannot change business settings, export data, or perform corrections.
- Must not access other businesses.

**Platform administrator**
- Handles platform operations and support.
- Has no in-app admin UI in MVP. Supabase dashboard access is limited to named founders with MFA enabled.
- Any access to seller data for support must be requested by the seller, limited in time, and written to a support log.

For MVP, exactly one `OWNER` per business. The `business_members` table exists so team access can be added later without redesigning tables.

---

## 5. User Stories and Acceptance Criteria

| ID | Story | Acceptance criteria |
|---|---|---|
| US-001 | Sign up and create a business | User signs up through Supabase Auth, verifies email, and completes onboarding that creates one business and an `OWNER` membership in one transaction. Re-running onboarding does not create a second business. |
| US-002 | Log in and out | Protected routes and API calls require a valid Supabase access token; logout clears the session in the browser and revokes the refresh token. |
| US-003 | View business profile | Owner sees and edits only their business settings, including order prefix. |
| US-004 | Manage customers | Owner can create, search by name/phone, edit, view order history, and archive customers. |
| US-005 | Manage addresses | Customer can have saved delivery addresses; the order keeps its own copy of the address used. |
| US-006 | Manage products | Owner can create/edit/archive products and search by name or SKU. |
| US-007 | Create an order | Owner selects channel, fulfilment type, customer, items, quantities, prices, discount, delivery fee, payment method, optional initial payment, and delivery details. Server calculates totals and allocates the order number. |
| US-008 | View orders | List supports pagination, search, date range, order status, payment status, delivery status, and source channel. |
| US-009 | Edit an order | Items, prices, discount and fee can be edited only before dispatch/completion; every change is recorded as an event. |
| US-010 | Change order status | Server validates allowed transitions (Section 7.2) and creates an event record. |
| US-011 | Record payment | Full or partial payment is stored; overpayment is rejected; balance and payment status are recalculated in the same transaction. |
| US-012 | Record refund | Refund is a separate record, cannot exceed net amount paid, optionally links to the original payment; nothing is deleted. |
| US-013 | Update delivery | Courier, tracking number, COD amount, and delivery status can be recorded; `DELIVERED` completes the order automatically. |
| US-014 | Settle COD | Owner marks a delivered COD order as settled; a `PAYMENT` record with method `COD` is created. |
| US-015 | View dashboard | Each metric follows the definitions in Section 15, using date boundaries in the business timezone. |
| US-016 | Export orders | CSV contains only the authorized business's data and protects against spreadsheet formula injection. |
| US-017 | Copy customer message | Template uses the correct order number, total, balance, and delivery details. |
| US-018 | Prevent cross-tenant access | User cannot read, modify, export, or infer another business's records by changing an ID or request parameter. |
| US-019 | Use on mobile | Order creation and status update flows work at 360px width. |
| US-020 | Recover from errors | Validation, network, and server errors show clear feedback without losing form input; retried submissions do not create duplicates. |
| US-021 | Recover data | Backup restoration procedure is documented and tested before production. |

### Definition of done

A feature is complete only when:
- UI is implemented.
- API and database behavior are implemented.
- Server-side validation is present.
- Authorization and tenant scoping are enforced.
- Loading, empty, success, and error states exist.
- Relevant automated tests pass.
- No secrets or personal data are unnecessarily logged.
- Documentation is updated if behavior or API contracts changed.

---

## 6. Main Screens and UX Requirements

### 6.1 Navigation

Desktop:
- Dashboard
- Orders
- Customers
- Products
- Reports (basic)
- Settings

Mobile:
- Bottom navigation: Dashboard, Orders, **+ New order** (centre, prominent), Customers, More.
- Avoid wide tables; use cards on mobile.

### 6.2 Dashboard

Show (definitions in Section 15):
- Orders created today.
- Orders needing action (`NEW`, `PENDING_CONFIRMATION`).
- Orders ready to send (`READY`, delivery `PENDING`).
- Out for delivery (delivery `DISPATCHED`).
- Delivered in selected date range.
- Payments received (net) in selected period.
- Outstanding customer balances.
- COD with courier, awaiting settlement.
- Refunds owed (cancelled/returned orders with money still held).
- Recent orders.

Never combine order value, money received, and COD awaiting settlement into one figure.

### 6.3 Orders list

Fields:
- Order number.
- Created date/time.
- Customer name and phone (phone partially masked on the list, e.g. `077 ••• 4567`).
- Total and balance due.
- Stage label (Section 7.3), plus payment status badge.
- Source channel.

Filters:
- Search by order number, customer name, or phone.
- Created date range.
- Order status.
- Payment status.
- Delivery status.
- Source channel.

Requirements:
- Server-side pagination (default 25, maximum 100).
- Stable sorting (`created_at DESC, id DESC`).
- Clear filters.
- Useful empty state.
- Confirm before cancellation.
- No unbounded result sets.

### 6.4 Create/edit order

Field sequence:
1. Source channel.
2. Existing customer, or quick-create customer (name + phone). Walk-in orders may skip the customer.
3. Fulfilment type: Delivery (default) or Pickup.
4. If Delivery: recipient name, phone, address, city, district, optional postal code — pre-filled from the customer's default address.
5. Order items (product or custom item), quantity, unit price (pre-filled from product, editable).
6. Order discount (fixed amount).
7. Delivery fee (pre-filled from business default; 0 for pickup).
8. Payment method: Cash, Bank transfer, COD, or Other; and amount received now (optional).
9. Private notes.
10. Review summary → Save.

Requirements:
- Quick-add customer/product opens in a sheet and does not discard entered data.
- Quantity: whole number 1–9,999.
- Custom items (no catalogue product) are allowed and need only a name and price.
- The browser shows a live preview, but the server calculates the authoritative totals.
- Disable the Save button while submitting and send an `Idempotency-Key`.
- If save fails, keep form input.
- "Save address to customer" checkbox when a new address is typed.

### 6.5 Order details

Sections:
- Order number, created date, stage label.
- Customer and the order's own copy of the delivery details.
- Item lines and amount breakdown.
- Order status actions (only buttons for allowed transitions).
- Payment summary: total, paid, refunded, balance; payment history; record payment/refund.
- Delivery card: courier, tracking number, COD amount, delivery status, COD status, "Mark COD settled".
- Activity timeline.
- Private notes.
- Copyable message templates.
- Cancel/return actions where allowed.

### 6.6 Customers

- Search by name and phone.
- Show last order date and order count.
- Display order history.
- Support multiple addresses with one default.
- Archive rather than delete customers referenced by orders.

### 6.7 Products

- Name, optional SKU, selling price, optional description, active/archived.
- No inventory quantities in MVP.
- Archiving a product does not change existing orders.

### 6.8 Settings

- Business name and contact phone.
- Order prefix (2–6 uppercase letters/digits; shows a preview such as `NIM-0042`).
- Currency (LKR, read-only in MVP).
- Timezone (default `Asia/Colombo`).
- Default delivery fee.
- Message templates (read-only defaults in MVP).
- Account: change password, sign out of all devices.
- Data export and account closure information.

### 6.9 Accessibility and usability

- Readable contrast and visible focus.
- Labels associated with form controls.
- Status badges use text and icon, not colour alone.
- Keyboard navigation on desktop.
- Helpful validation messages in plain language.
- Test at 360px width and with throttled "Slow 3G" networking.
- English UI in MVP; keep all strings in one place so Sinhala and Tamil can be added.

---

## 7. Domain Rules and Status Models

### 7.1 Three status dimensions, one owner each

| Dimension | Stored on | Who changes it |
|---|---|---|
| Order status | `orders.order_status` | Seller actions, plus automatic changes caused by delivery events. |
| Payment status | `orders.payment_status` | Only the payment calculation function (Section 7.6). Never set directly by the client. |
| Delivery status | `deliveries.status` | Seller delivery actions. Exists only for `DELIVERY` orders. |
| COD status | `deliveries.cod_status` | Delivery events and the "settle COD" action. |

**Order status** — the seller's own workflow:
- `NEW`
- `PENDING_CONFIRMATION`
- `CONFIRMED`
- `PREPARING`
- `READY`
- `COMPLETED`
- `CANCELLED`
- `RETURNED`

**Payment status** (calculated):
- `UNPAID`
- `PARTIALLY_PAID`
- `PAID`
- `PARTIALLY_REFUNDED`
- `REFUNDED`

**Delivery status** (only for `DELIVERY` orders):
- `PENDING`
- `DISPATCHED`
- `DELIVERED`
- `FAILED`
- `RETURNED`

**COD status**:
- `NOT_APPLICABLE`
- `PENDING`
- `COLLECTED`
- `SETTLED`

Use enums in TypeScript and PostgreSQL. The client sends an action (e.g. "dispatch"), never a raw status string to store.

### 7.2 Transition rules

**Order status — seller actions**

| From | Allowed to | Notes |
|---|---|---|
| `NEW` | `PENDING_CONFIRMATION`, `CONFIRMED`, `CANCELLED` | |
| `PENDING_CONFIRMATION` | `CONFIRMED`, `CANCELLED` | |
| `CONFIRMED` | `PREPARING`, `READY`, `CANCELLED` | Skipping `PREPARING` is allowed. |
| `PREPARING` | `READY`, `CANCELLED` | |
| `READY` | `COMPLETED` (pickup only), `CANCELLED` (only if not dispatched) | Delivery orders complete through delivery events. |
| `COMPLETED` | `RETURNED` (owner correction, reason required) | |
| `CANCELLED` | none | Terminal. |
| `RETURNED` | none | Terminal. |

**Delivery status**

| From | Allowed to | Precondition / side effect |
|---|---|---|
| `PENDING` | `DISPATCHED` | Order must be `READY`. Sets `dispatched_at`, increments `attempt_count`, freezes `cod_amount`. |
| `DISPATCHED` | `DELIVERED` | Sets `delivered_at`; order → `COMPLETED`; if COD, `cod_status` → `COLLECTED`. |
| `DISPATCHED` | `FAILED` | `failed_reason` required. |
| `FAILED` | `DISPATCHED` | Re-attempt; increments `attempt_count`. |
| `FAILED` | `RETURNED` | Order → `RETURNED`; `cod_status` → `NOT_APPLICABLE`. |
| `DELIVERED` | `RETURNED` | Owner correction, reason required; order → `RETURNED`. If money was already received, the order shows under "Refunds owed" until a refund is recorded. |

For `DELIVERY` orders, returns always go through the delivery action so both statuses change together. The order-level `COMPLETED → RETURNED` action is used only for `PICKUP` orders.

**COD status**

| From | To | Trigger |
|---|---|---|
| `NOT_APPLICABLE` | `PENDING` | Order saved with payment method `COD` and `cod_amount > 0`. |
| `PENDING` | `COLLECTED` | Delivery marked `DELIVERED`. |
| `COLLECTED` | `SETTLED` | Seller marks "COD settled"; creates a `PAYMENT` with method `COD`. |
| `PENDING` / `COLLECTED` | `NOT_APPLICABLE` | Order cancelled or returned before settlement. |

Every transition writes an `order_events` row with actor, timestamp, old value, new value, and reason. All automatic changes (delivery → order, delivery → COD) happen in the same database transaction as the triggering change.

Adjust these rules after pilot feedback, and record the change in Section 21.

### 7.3 Display stage (derived, not stored)

The UI shows one simple label calculated from the stored statuses:

| Order status | Delivery status | Stage label |
|---|---|---|
| `NEW` | any | New |
| `PENDING_CONFIRMATION` | any | Awaiting confirmation |
| `CONFIRMED` | any | Confirmed |
| `PREPARING` | any | Preparing |
| `READY` | `PENDING` or none | Ready to send / Ready for pickup |
| `READY` | `DISPATCHED` | Out for delivery |
| `READY` | `FAILED` | Delivery failed |
| `COMPLETED` | `DELIVERED` or none | Completed |
| `CANCELLED` | any | Cancelled |
| `RETURNED` | any | Returned |

Implement this once in `packages/shared` so the web app and CSV export use the same labels.

### 7.4 Editing rules

| Field group | Editable when |
|---|---|
| Items, quantities, prices, discount, delivery fee | Order is `NEW`, `PENDING_CONFIRMATION`, `CONFIRMED`, `PREPARING`, or `READY` **and** delivery is not `DISPATCHED`/later, **and** new total ≥ net amount paid. |
| Delivery address copy, recipient | Before dispatch. |
| Courier name, tracking number | Any time before `RETURNED`. |
| Notes | Any time. |
| Source channel | Any time before `COMPLETED`/`CANCELLED`/`RETURNED`. |
| Fulfilment type | Before dispatch; switching to `PICKUP` deletes the pending `deliveries` row (logged); switching to `DELIVERY` creates one. |

If an edit would make the total lower than the net amount already paid, reject it with `ORDER_TOTAL_BELOW_PAID`; the seller must record a refund first.

### 7.5 Money calculations

For each order line:

`line_total = quantity × unit_price`

`subtotal = sum(line_total)`

`total_amount = subtotal − discount_amount + delivery_fee`

`net_paid = sum(PAYMENT amounts) − sum(REFUND amounts)`

`balance_due = max(0, total_amount − net_paid)` for active orders; `0` for `CANCELLED` and `RETURNED` orders.

`refund_owed = net_paid` for `CANCELLED` and `RETURNED` orders; `0` otherwise.

Rules:
- Discount is a single fixed amount on the order, applied to the item subtotal before the delivery fee. `0 ≤ discount_amount ≤ subtotal`.
- No per-line discounts in MVP. A seller who wants a cheaper item edits that line's unit price.
- `delivery_fee ≥ 0`; `unit_price ≥ 0`; `total_amount ≥ 0`.
- All amounts ≤ 99,999,999.99 (fits `NUMERIC(12,2)`).
- Money is stored as PostgreSQL `NUMERIC(12,2)`, read as Prisma `Decimal`, calculated with `decimal.js`, and sent in JSON as strings (e.g. `"1500.00"`). Never use JavaScript `number` for money.
- Round half-up to 2 decimals only at the line-total level.
- All money calculations live in one module: `apps/api/src/orders/order-calculator.ts`.

### 7.6 Payment status calculation

Payment status is stored on `orders` (so the list can filter and index it) together with cached `amount_paid` and `amount_refunded`. They are **always recalculated from the `payments` table**, never incremented, by a single function `recalculatePaymentSummary(tx, orderId)` that runs inside the same transaction as any payment, refund, or total change. The order row is locked first (`SELECT … FOR UPDATE`) to serialize concurrent changes.

```
paid     = sum(amount) where type = PAYMENT
refunded = sum(amount) where type = REFUND
net      = paid − refunded

if paid == 0                       → UNPAID
else if refunded > 0 and net == 0  → REFUNDED
else if refunded > 0               → PARTIALLY_REFUNDED
else if net >= total_amount        → PAID
else                               → PARTIALLY_PAID
```

### 7.7 Payment and refund policy

- Payment methods: `CASH`, `BANK_TRANSFER`, `COD`, `OTHER`.
- Record types: `PAYMENT`, `REFUND`. Amounts are always positive; the type gives the direction.
- **Overpayment is rejected**: a payment may not make `net_paid` exceed `total_amount` (`PAYMENT_EXCEEDS_BALANCE`).
- **Refunds** may not exceed current `net_paid` (`REFUND_EXCEEDS_PAID`). `refund_of_payment_id` is optional.
- Payments cannot be recorded on `CANCELLED` or `RETURNED` orders; refunds can.
- Cancelling or returning an order does **not** refund automatically. If `net_paid > 0`, the UI prompts the seller to record a refund, and the order appears under "Refunds owed" until they do.
- Payment records are never edited or deleted. A mistake is corrected with a refund record whose note says "correction".
- `occurred_at` (when money changed hands) is separate from `created_at` (when it was typed in) and may be backdated up to 90 days.

### 7.8 Cash on delivery (COD)

COD money goes customer → courier → seller, usually days later and often in a batch.

1. COD is allowed only for `DELIVERY` orders. The order's `payment_method` is `COD`. At creation `cod_amount` defaults to `balance_due` (after any advance payment). `cod_status = PENDING`.
2. `cod_amount` can be edited until dispatch, and must be `0 ≤ cod_amount ≤ balance_due`. It is frozen at dispatch.
3. Delivery `DELIVERED` → `cod_status = COLLECTED` (the courier has the money). No payment is created yet.
4. Seller marks "COD settled" with the date received → one `PAYMENT` (method `COD`, amount `cod_amount`, `occurred_at` = settlement date) is created and `cod_status = SETTLED`, in one transaction.
5. Courier deductions are not tracked in MVP. The payment records the full amount the customer paid; courier fees are the seller's cost outside this system.

Dashboard figures are kept separate: **COD out for delivery** (`PENDING` + dispatched), **COD with courier** (`COLLECTED`), and **payments received** (actual `PAYMENT` records).

### 7.9 Source channels and fulfilment

Source channels: `FACEBOOK`, `INSTAGRAM`, `TIKTOK`, `WHATSAPP`, `PHONE`, `WALK_IN`, `WEBSITE`, `OTHER`. Store codes, not display labels. `source_note` (max 100 chars) is required when `OTHER`.

Fulfilment types: `DELIVERY` (default) and `PICKUP`. A `deliveries` row exists only for `DELIVERY` orders (one row per order).

### 7.10 Customers on orders

- `customer_id` is **required**, except when `source_channel = WALK_IN`, where it may be null for an anonymous sale.
- Anonymous walk-in orders store `customer_name_snapshot = 'Walk-in customer'` and `customer_phone_snapshot = NULL`, and must use `PICKUP`.
- The order always stores its own copy of the customer name and phone at creation.

### 7.11 Phone and address handling

- Store phone numbers as text.
- Normalize with `libphonenumber-js` using default country `LK` into E.164 (`+94771234567`), stored in `phone_normalized`; keep what the user typed in `phone_display`.
- Accept `0771234567`, `771234567`, `+94 77 123 4567`, `0094771234567`, with spaces or dashes.
- If a number cannot be parsed, save it with `phone_normalized = NULL` and show a warning; do not block the seller.
- Search by phone uses the normalized form, and also matches the last 9 digits.
- Delivery address fields are copied onto the order at creation. Editing the customer's saved address never changes existing orders.
- Only `address_line_1` is required; city, district, and postal code are optional.
- Districts: a fixed list of Sri Lanka's 25 districts in the UI; stored as text.

### 7.12 Order number generation

- Format: `{PREFIX}-{N}` with `N` zero-padded to at least 4 digits, e.g. `NIM-0001`, `NIM-12345`. Short numbers are easier to say on the phone and type in WhatsApp.
- `PREFIX`: 2–6 uppercase letters or digits, per business, suggested from the business name at onboarding (default `ORD`).
- No annual reset.
- Allocation: a `business_counters` row per business, incremented atomically inside the order-creation transaction:

```sql
UPDATE app.business_counters
SET    next_order_seq = next_order_seq + 1
WHERE  business_id = $1
RETURNING next_order_seq - 1 AS seq;
```

- The row lock serializes concurrent creation for the same business. If the transaction rolls back, the number is not used (gaps are acceptable and expected).
- Changing the prefix affects only new orders. `UNIQUE (business_id, order_number)` remains the final guarantee.
- The UUID `id` stays the primary key; the order number is only for people.

---

## 8. Database Design

PostgreSQL hosted on **Supabase**, accessed only by the NestJS API through **Prisma**. The browser never queries the database directly; it uses Supabase only for authentication.

### 8.1 Placement and conventions

- All application tables live in a dedicated PostgreSQL schema **`app`**, not `public`. `app` is **not** added to Supabase's exposed Data API schemas, so the auto-generated REST/GraphQL APIs cannot reach it.
- Prisma declares the schema explicitly: `schemas = ["app"]` in the datasource and `@@schema("app")` on every model and enum.
- Primary keys are UUIDs. `users.id` equals the Supabase Auth user ID; all other IDs are generated by the database (`gen_random_uuid()`).
- Every tenant-owned table has a `business_id` column and a `UNIQUE (business_id, id)` constraint, so child tables can use **composite foreign keys** `(business_id, parent_id) → parent(business_id, id)`. The database itself then rejects linking an order to another business's customer, product, or address.
- Timestamps are `TIMESTAMPTZ`, stored in UTC, shown in the business timezone.
- Money is `NUMERIC(12,2)`.
- Businesses, customers, products, and addresses are archived (`archived_at`), never hard-deleted while referenced.
- Orders, payments, and events are never hard-deleted in normal operation.

### 8.2 Tables

#### `users`
Mirror of the Supabase Auth user, created during onboarding.
- `id UUID PRIMARY KEY` — same value as `auth.users.id` (no foreign key into the `auth` schema; Supabase manages that schema)
- `email TEXT NOT NULL UNIQUE` (lower-cased)
- `full_name TEXT NULL`
- `created_at`, `updated_at`
- `disabled_at TIMESTAMPTZ NULL`

No password data is stored in `app`. Email changes in Supabase Auth are synced on the next `/me` call.

#### `businesses`
- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `contact_phone TEXT NULL`
- `order_prefix VARCHAR(6) NOT NULL DEFAULT 'ORD'` — `CHECK (order_prefix ~ '^[A-Z0-9]{2,6}$')`
- `currency CHAR(3) NOT NULL DEFAULT 'LKR'`
- `timezone TEXT NOT NULL DEFAULT 'Asia/Colombo'`
- `default_delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0`
- `created_at`, `updated_at`
- `archived_at TIMESTAMPTZ NULL`

#### `business_counters`
- `business_id UUID PRIMARY KEY` → `businesses(id)`
- `next_order_seq INTEGER NOT NULL DEFAULT 1` — `CHECK (next_order_seq >= 1)`

Created in the same transaction as the business.

#### `business_members`
- `business_id UUID` → `businesses(id)`
- `user_id UUID` → `users(id)`
- `role member_role NOT NULL` (`OWNER`, `STAFF`)
- `created_at`
- Primary key `(business_id, user_id)`
- Partial unique index: one `OWNER` per business in MVP.

Platform administrators are not business members.

#### `customers`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `name TEXT NOT NULL`
- `phone_display TEXT NULL`
- `phone_normalized TEXT NULL`
- `email TEXT NULL`
- `notes TEXT NULL`
- `created_at`, `updated_at`, `archived_at`
- Indexes: `(business_id, phone_normalized)`, `(business_id, name)`; trigram index on `name` for search (`pg_trgm`).

Phone is not unique; family members share numbers.

#### `customer_addresses`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `customer_id UUID NOT NULL` → composite FK `(business_id, customer_id)` → `customers(business_id, id)`
- `label TEXT NULL` (e.g. "Home", "Office")
- `recipient_name TEXT NOT NULL`
- `phone TEXT NOT NULL`
- `address_line_1 TEXT NOT NULL`, `address_line_2 TEXT NULL`
- `city TEXT NULL`, `district TEXT NULL`, `postal_code TEXT NULL`
- `is_default BOOLEAN NOT NULL DEFAULT FALSE`
- `created_at`, `updated_at`, `archived_at`
- Partial unique index: one default per customer `(customer_id) WHERE is_default AND archived_at IS NULL`.

#### `products`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `name TEXT NOT NULL`
- `sku TEXT NULL`
- `description TEXT NULL`
- `selling_price NUMERIC(12,2) NOT NULL` — `CHECK (selling_price >= 0)`
- `created_at`, `updated_at`, `archived_at`
- Partial unique index `(business_id, sku) WHERE sku IS NOT NULL AND archived_at IS NULL`.

(v1.0 had both `is_active` and `archived_at`; v1.1 uses only `archived_at`.)

#### `orders`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `order_number TEXT NOT NULL`
- `customer_id UUID NULL` → composite FK to `customers`
- `source_channel source_channel NOT NULL`, `source_note TEXT NULL`
- `fulfilment_type fulfilment_type NOT NULL DEFAULT 'DELIVERY'`
- `order_status order_status NOT NULL DEFAULT 'NEW'`
- `payment_method payment_method NOT NULL` — how the customer is expected to pay
- `payment_status payment_status NOT NULL DEFAULT 'UNPAID'` — calculated (Section 7.6)
- `currency CHAR(3) NOT NULL`
- `subtotal`, `discount_amount`, `delivery_fee`, `total_amount` — `NUMERIC(12,2) NOT NULL`
- `amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0` — cached sum of payments
- `amount_refunded NUMERIC(12,2) NOT NULL DEFAULT 0` — cached sum of refunds
- `customer_name_snapshot TEXT NOT NULL`
- `customer_phone_snapshot TEXT NULL`
- `notes TEXT NULL`
- `created_by UUID NOT NULL` → `users(id)`
- `created_at`, `updated_at`
- `completed_at`, `cancelled_at TIMESTAMPTZ NULL`, `cancel_reason TEXT NULL`

Constraints:
- `UNIQUE (business_id, order_number)`
- `CHECK (discount_amount >= 0 AND discount_amount <= subtotal)`
- `CHECK (delivery_fee >= 0 AND total_amount >= 0)`
- `CHECK (amount_paid >= amount_refunded)`
- `CHECK (customer_id IS NOT NULL OR source_channel = 'WALK_IN')`
- `CHECK (source_channel <> 'OTHER' OR source_note IS NOT NULL)`

Indexes: `(business_id, created_at DESC)`, `(business_id, order_status, created_at DESC)`, `(business_id, payment_status, created_at DESC)`, `(business_id, source_channel, created_at DESC)`, `(business_id, customer_id)`.

Delivery address and recipient copies are stored on `deliveries` (only delivery orders need them).

#### `order_items`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `order_id UUID NOT NULL` → composite FK to `orders`
- `product_id UUID NULL` → composite FK to `products`
- `position SMALLINT NOT NULL` — display order
- `product_name_snapshot TEXT NOT NULL`
- `sku_snapshot TEXT NULL`
- `quantity INTEGER NOT NULL` — `CHECK (quantity BETWEEN 1 AND 9999)`
- `unit_price NUMERIC(12,2) NOT NULL` — `CHECK (unit_price >= 0)`
- `line_total NUMERIC(12,2) NOT NULL`
- `created_at`

No `line_discount` column (Section 7.5). Items are replaced as a set when the order is edited before dispatch; the event log keeps the before/after summary.

#### `payments`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `order_id UUID NOT NULL` → composite FK to `orders`
- `type payment_type NOT NULL` (`PAYMENT`, `REFUND`)
- `method payment_method NOT NULL`
- `amount NUMERIC(12,2) NOT NULL` — `CHECK (amount > 0)`
- `refund_of_payment_id UUID NULL` → composite FK to `payments`; `CHECK (refund_of_payment_id IS NULL OR type = 'REFUND')`
- `reference TEXT NULL` (bank reference, receipt number)
- `notes TEXT NULL`
- `recorded_by UUID NOT NULL` → `users(id)`
- `occurred_at TIMESTAMPTZ NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- Index `(business_id, occurred_at)`, `(order_id)`.

Rows are insert-only; there is no update or delete endpoint.

#### `deliveries`
One row per `DELIVERY` order.
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `order_id UUID NOT NULL UNIQUE` → composite FK to `orders`
- `status delivery_status NOT NULL DEFAULT 'PENDING'`
- `recipient_name TEXT NOT NULL`
- `phone TEXT NOT NULL`
- `address_line_1 TEXT NOT NULL`, `address_line_2 TEXT NULL`
- `city TEXT NULL`, `district TEXT NULL`, `postal_code TEXT NULL`
- `source_address_id UUID NULL` — which saved address it was copied from (informational only)
- `courier_name TEXT NULL`
- `tracking_number TEXT NULL`
- `cod_amount NUMERIC(12,2) NOT NULL DEFAULT 0` — `CHECK (cod_amount >= 0)`
- `cod_status cod_status NOT NULL DEFAULT 'NOT_APPLICABLE'`
- `cod_settled_at TIMESTAMPTZ NULL`
- `cod_payment_id UUID NULL` → the `PAYMENT` created at settlement
- `attempt_count SMALLINT NOT NULL DEFAULT 0`
- `dispatched_at`, `delivered_at TIMESTAMPTZ NULL`
- `failed_reason TEXT NULL`
- `notes TEXT NULL`
- `created_at`, `updated_at`
- Indexes: `(business_id, status, updated_at DESC)`, `(business_id, cod_status)`.

Each delivery attempt's history is kept in `order_events`; a separate `delivery_attempts` table is deferred to v1.1.

#### `order_events`
- `id UUID PRIMARY KEY`, `business_id UUID NOT NULL`
- `order_id UUID NOT NULL` → composite FK to `orders`
- `actor_user_id UUID NULL` (null for system-caused changes)
- `type order_event_type NOT NULL` — e.g. `ORDER_CREATED`, `ORDER_UPDATED`, `ORDER_STATUS_CHANGED`, `DELIVERY_STATUS_CHANGED`, `PAYMENT_RECORDED`, `REFUND_RECORDED`, `COD_STATUS_CHANGED`, `NOTE_ADDED`
- `old_value JSONB NULL`, `new_value JSONB NULL`
- `reason TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- Index `(order_id, created_at)`.

Insert-only. Do not copy phone numbers or addresses into event JSON; record which fields changed instead.

#### `idempotency_keys`
- `business_id UUID`, `key TEXT`, primary key `(business_id, key)`
- `user_id UUID NOT NULL`
- `endpoint TEXT NOT NULL`
- `request_hash TEXT NOT NULL`
- `response_status SMALLINT NULL`, `response_body JSONB NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- Rows older than 48 hours are deleted by a scheduled job.

#### `subscriptions` (deferred until paid launch)
- `id`, `business_id`, `plan_code`, `status`, `starts_at`, `ends_at`, `provider`, `provider_reference`, `created_at`, `updated_at`.

Never store card details.

### 8.3 Data integrity requirements

- Foreign keys, composite tenant foreign keys, unique constraints, and the `CHECK` constraints above are mandatory.
- `CHECK` constraints and partial indexes that Prisma cannot express are added by hand to the generated migration SQL and reviewed.
- Use one database transaction for: onboarding, order creation, order edits, status changes with side effects, payments/refunds, COD settlement.
- Lock the order row (`SELECT … FOR UPDATE`) at the start of any transaction that changes money or status on that order.
- Never rely only on frontend validation.
- Every schema change goes through a Prisma migration; no manual edits in the Supabase table editor on staging or production.

### 8.4 Prisma schema

Complete core schema. Run `npx prisma validate` and review the generated SQL before the first migration.

> **Prisma version:** this schema targets **Prisma 7** and was checked with Prisma's current schema validator. In Prisma 7, connection URLs are no longer written in `schema.prisma`: the CLI reads them from `prisma.config.ts`, and the app passes a driver adapter to `PrismaClient`. Pin the exact version in `package.json` at setup.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  schemas  = ["app"] // all application tables live in the private `app` schema
  // Connection URLs are NOT set here in Prisma 7 — see prisma.config.ts and the PrismaPg adapter below.
}

// ---------- Enums ----------

enum MemberRole {
  OWNER
  STAFF

  @@schema("app")
}
enum SourceChannel {
  FACEBOOK
  INSTAGRAM
  TIKTOK
  WHATSAPP
  PHONE
  WALK_IN
  WEBSITE
  OTHER

  @@schema("app")
}
enum FulfilmentType {
  DELIVERY
  PICKUP

  @@schema("app")
}
enum OrderStatus {
  NEW
  PENDING_CONFIRMATION
  CONFIRMED
  PREPARING
  READY
  COMPLETED
  CANCELLED
  RETURNED

  @@schema("app")
}
enum PaymentStatus {
  UNPAID
  PARTIALLY_PAID
  PAID
  PARTIALLY_REFUNDED
  REFUNDED

  @@schema("app")
}
enum PaymentMethod {
  CASH
  BANK_TRANSFER
  COD
  OTHER

  @@schema("app")
}
enum PaymentType {
  PAYMENT
  REFUND

  @@schema("app")
}
enum DeliveryStatus {
  PENDING
  DISPATCHED
  DELIVERED
  FAILED
  RETURNED

  @@schema("app")
}
enum CodStatus {
  NOT_APPLICABLE
  PENDING
  COLLECTED
  SETTLED

  @@schema("app")
}
enum OrderEventType {
  ORDER_CREATED
  ORDER_UPDATED
  ORDER_STATUS_CHANGED
  DELIVERY_STATUS_CHANGED
  PAYMENT_RECORDED
  REFUND_RECORDED
  COD_STATUS_CHANGED
  NOTE_ADDED

  @@schema("app")
}

// ---------- Identity & tenancy ----------

model User {
  id         String    @id @db.Uuid // = Supabase auth.users.id
  email      String    @unique
  fullName   String?   @map("full_name")
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  disabledAt DateTime? @map("disabled_at") @db.Timestamptz

  memberships     BusinessMember[]
  ordersCreated   Order[]          @relation("OrderCreatedBy")
  paymentsRecorded Payment[]       @relation("PaymentRecordedBy")

  @@map("users")

  @@schema("app")
}

model Business {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name               String
  contactPhone       String?   @map("contact_phone")
  orderPrefix        String    @default("ORD") @map("order_prefix") @db.VarChar(6)
  currency           String    @default("LKR") @db.Char(3)
  timezone           String    @default("Asia/Colombo")
  defaultDeliveryFee Decimal   @default(0) @map("default_delivery_fee") @db.Decimal(12, 2)
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt          DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt         DateTime? @map("archived_at") @db.Timestamptz

  counter   BusinessCounter?
  members   BusinessMember[]
  customers Customer[]
  addresses CustomerAddress[]
  products  Product[]
  orders    Order[]
  items     OrderItem[]
  payments  Payment[]
  deliveries Delivery[]
  events    OrderEvent[]

  @@map("businesses")

  @@schema("app")
}

model BusinessCounter {
  businessId   String   @id @map("business_id") @db.Uuid
  nextOrderSeq Int      @default(1) @map("next_order_seq")
  business     Business @relation(fields: [businessId], references: [id], onDelete: Restrict)

  @@map("business_counters")

  @@schema("app")
}

model BusinessMember {
  businessId String     @map("business_id") @db.Uuid
  userId     String     @map("user_id") @db.Uuid
  role       MemberRole
  createdAt  DateTime   @default(now()) @map("created_at") @db.Timestamptz

  business Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  user     User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@id([businessId, userId])
  @@index([userId])
  @@map("business_members")

  @@schema("app")
}

// ---------- Catalogue & customers ----------

model Customer {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId      String    @map("business_id") @db.Uuid
  name            String
  phoneDisplay    String?   @map("phone_display")
  phoneNormalized String?   @map("phone_normalized")
  email           String?
  notes           String?
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt      DateTime? @map("archived_at") @db.Timestamptz

  business  Business          @relation(fields: [businessId], references: [id], onDelete: Restrict)
  addresses CustomerAddress[]
  orders    Order[]

  @@unique([businessId, id])
  @@index([businessId, phoneNormalized])
  @@index([businessId, name])
  @@map("customers")

  @@schema("app")
}

model CustomerAddress {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId   String    @map("business_id") @db.Uuid
  customerId   String    @map("customer_id") @db.Uuid
  label        String?
  recipientName String   @map("recipient_name")
  phone        String
  addressLine1 String    @map("address_line_1")
  addressLine2 String?   @map("address_line_2")
  city         String?
  district     String?
  postalCode   String?   @map("postal_code")
  isDefault    Boolean   @default(false) @map("is_default")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt   DateTime? @map("archived_at") @db.Timestamptz

  business Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  customer Customer @relation(fields: [businessId, customerId], references: [businessId, id], onDelete: Restrict)

  @@unique([businessId, id])
  @@index([businessId, customerId])
  @@map("customer_addresses")

  @@schema("app")
}

model Product {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId   String    @map("business_id") @db.Uuid
  name         String
  sku          String?
  description  String?
  sellingPrice Decimal   @map("selling_price") @db.Decimal(12, 2)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt   DateTime? @map("archived_at") @db.Timestamptz

  business Business    @relation(fields: [businessId], references: [id], onDelete: Restrict)
  items    OrderItem[]

  @@unique([businessId, id])
  @@index([businessId, name])
  @@map("products")

  @@schema("app")
}

// ---------- Orders ----------

model Order {
  id                    String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId            String         @map("business_id") @db.Uuid
  orderNumber           String         @map("order_number")
  customerId            String?        @map("customer_id") @db.Uuid
  sourceChannel         SourceChannel  @map("source_channel")
  sourceNote            String?        @map("source_note")
  fulfilmentType        FulfilmentType @default(DELIVERY) @map("fulfilment_type")
  orderStatus           OrderStatus    @default(NEW) @map("order_status")
  paymentMethod         PaymentMethod  @map("payment_method")
  paymentStatus         PaymentStatus  @default(UNPAID) @map("payment_status")
  currency              String         @db.Char(3)
  subtotal              Decimal        @db.Decimal(12, 2)
  discountAmount        Decimal        @default(0) @map("discount_amount") @db.Decimal(12, 2)
  deliveryFee           Decimal        @default(0) @map("delivery_fee") @db.Decimal(12, 2)
  totalAmount           Decimal        @map("total_amount") @db.Decimal(12, 2)
  amountPaid            Decimal        @default(0) @map("amount_paid") @db.Decimal(12, 2)
  amountRefunded        Decimal        @default(0) @map("amount_refunded") @db.Decimal(12, 2)
  customerNameSnapshot  String         @map("customer_name_snapshot")
  customerPhoneSnapshot String?        @map("customer_phone_snapshot")
  notes                 String?
  createdById           String         @map("created_by") @db.Uuid
  createdAt             DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime       @updatedAt @map("updated_at") @db.Timestamptz
  completedAt           DateTime?      @map("completed_at") @db.Timestamptz
  cancelledAt           DateTime?      @map("cancelled_at") @db.Timestamptz
  cancelReason          String?        @map("cancel_reason")

  business  Business    @relation(fields: [businessId], references: [id], onDelete: Restrict)
  customer  Customer?   @relation(fields: [businessId, customerId], references: [businessId, id], onDelete: Restrict)
  createdBy User        @relation("OrderCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  items     OrderItem[]
  payments  Payment[]
  delivery  Delivery?
  events    OrderEvent[]

  @@unique([businessId, id])
  @@unique([businessId, orderNumber])
  @@index([businessId, createdAt(sort: Desc)])
  @@index([businessId, orderStatus, createdAt(sort: Desc)])
  @@index([businessId, paymentStatus, createdAt(sort: Desc)])
  @@index([businessId, sourceChannel, createdAt(sort: Desc)])
  @@index([businessId, customerId])
  @@map("orders")

  @@schema("app")
}

model OrderItem {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId          String   @map("business_id") @db.Uuid
  orderId             String   @map("order_id") @db.Uuid
  productId           String?  @map("product_id") @db.Uuid
  position            Int      @db.SmallInt
  productNameSnapshot String   @map("product_name_snapshot")
  skuSnapshot         String?  @map("sku_snapshot")
  quantity            Int
  unitPrice           Decimal  @map("unit_price") @db.Decimal(12, 2)
  lineTotal           Decimal  @map("line_total") @db.Decimal(12, 2)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz

  business Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  order    Order    @relation(fields: [businessId, orderId], references: [businessId, id], onDelete: Restrict)
  product  Product? @relation(fields: [businessId, productId], references: [businessId, id], onDelete: Restrict)

  @@index([orderId])
  @@map("order_items")

  @@schema("app")
}

model Payment {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId        String        @map("business_id") @db.Uuid
  orderId           String        @map("order_id") @db.Uuid
  type              PaymentType
  method            PaymentMethod
  amount            Decimal       @db.Decimal(12, 2)
  refundOfPaymentId String?       @map("refund_of_payment_id") @db.Uuid
  reference         String?
  notes             String?
  recordedById      String        @map("recorded_by") @db.Uuid
  occurredAt        DateTime      @map("occurred_at") @db.Timestamptz
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz

  business   Business  @relation(fields: [businessId], references: [id], onDelete: Restrict)
  order      Order     @relation(fields: [businessId, orderId], references: [businessId, id], onDelete: Restrict)
  recordedBy User      @relation("PaymentRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
  refundOf   Payment?  @relation("RefundOf", fields: [businessId, refundOfPaymentId], references: [businessId, id], onDelete: Restrict)
  refunds    Payment[] @relation("RefundOf")

  @@unique([businessId, id])
  @@index([businessId, occurredAt])
  @@index([orderId])
  @@map("payments")

  @@schema("app")
}

model Delivery {
  id              String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId      String         @map("business_id") @db.Uuid
  orderId         String         @unique @map("order_id") @db.Uuid
  status          DeliveryStatus @default(PENDING)
  recipientName   String         @map("recipient_name")
  phone           String
  addressLine1    String         @map("address_line_1")
  addressLine2    String?        @map("address_line_2")
  city            String?
  district        String?
  postalCode      String?        @map("postal_code")
  sourceAddressId String?        @map("source_address_id") @db.Uuid
  courierName     String?        @map("courier_name")
  trackingNumber  String?        @map("tracking_number")
  codAmount       Decimal        @default(0) @map("cod_amount") @db.Decimal(12, 2)
  codStatus       CodStatus      @default(NOT_APPLICABLE) @map("cod_status")
  codSettledAt    DateTime?      @map("cod_settled_at") @db.Timestamptz
  codPaymentId    String?        @map("cod_payment_id") @db.Uuid
  attemptCount    Int            @default(0) @map("attempt_count") @db.SmallInt
  dispatchedAt    DateTime?      @map("dispatched_at") @db.Timestamptz
  deliveredAt     DateTime?      @map("delivered_at") @db.Timestamptz
  failedReason    String?        @map("failed_reason")
  notes           String?
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz

  business Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  order    Order    @relation(fields: [businessId, orderId], references: [businessId, id], onDelete: Restrict)

  @@unique([businessId, orderId]) // required for the composite 1:1 relation
  @@index([businessId, status, updatedAt(sort: Desc)])
  @@index([businessId, codStatus])
  @@map("deliveries")

  @@schema("app")
}

model OrderEvent {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  businessId  String         @map("business_id") @db.Uuid
  orderId     String         @map("order_id") @db.Uuid
  actorUserId String?        @map("actor_user_id") @db.Uuid
  type        OrderEventType
  oldValue    Json?          @map("old_value")
  newValue    Json?          @map("new_value")
  reason      String?
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz

  business Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  order    Order    @relation(fields: [businessId, orderId], references: [businessId, id], onDelete: Restrict)

  @@index([orderId, createdAt])
  @@map("order_events")

  @@schema("app")
}

model IdempotencyKey {
  businessId     String   @map("business_id") @db.Uuid
  key            String
  userId         String   @map("user_id") @db.Uuid
  endpoint       String
  requestHash    String   @map("request_hash")
  responseStatus Int?     @map("response_status") @db.SmallInt
  responseBody   Json?    @map("response_body")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@id([businessId, key])
  @@map("idempotency_keys")

  @@schema("app")
}
```

**`apps/api/prisma.config.ts`** — used by the Prisma CLI (migrate, studio, seed):

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DIRECT_URL') }, // session-level connection for migrations
});
```

**`apps/api/src/common/prisma.service.ts`** — runtime client through the Supabase pooler:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Check these two snippets against the Prisma + Supabase guide for the pinned Prisma version before first use.

### 8.5 Hand-written migration SQL

Add these to the initial migration (after Prisma's generated SQL) and keep them in source control:

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CHECK constraints
ALTER TABLE app.businesses   ADD CONSTRAINT businesses_prefix_chk   CHECK (order_prefix ~ '^[A-Z0-9]{2,6}$');
ALTER TABLE app.products     ADD CONSTRAINT products_price_chk      CHECK (selling_price >= 0);
ALTER TABLE app.order_items  ADD CONSTRAINT items_qty_chk           CHECK (quantity BETWEEN 1 AND 9999);
ALTER TABLE app.order_items  ADD CONSTRAINT items_price_chk         CHECK (unit_price >= 0 AND line_total >= 0);
ALTER TABLE app.orders       ADD CONSTRAINT orders_discount_chk     CHECK (discount_amount >= 0 AND discount_amount <= subtotal);
ALTER TABLE app.orders       ADD CONSTRAINT orders_amounts_chk      CHECK (delivery_fee >= 0 AND total_amount >= 0);
ALTER TABLE app.orders       ADD CONSTRAINT orders_paid_chk         CHECK (amount_paid >= amount_refunded);
ALTER TABLE app.orders       ADD CONSTRAINT orders_customer_chk     CHECK (customer_id IS NOT NULL OR source_channel = 'WALK_IN');
ALTER TABLE app.orders       ADD CONSTRAINT orders_other_note_chk   CHECK (source_channel <> 'OTHER' OR source_note IS NOT NULL);
ALTER TABLE app.payments     ADD CONSTRAINT payments_amount_chk     CHECK (amount > 0);
ALTER TABLE app.payments     ADD CONSTRAINT payments_refund_of_chk  CHECK (refund_of_payment_id IS NULL OR type = 'REFUND');
ALTER TABLE app.deliveries   ADD CONSTRAINT deliveries_cod_chk      CHECK (cod_amount >= 0);

-- Partial unique indexes
CREATE UNIQUE INDEX business_one_owner      ON app.business_members (business_id) WHERE role = 'OWNER';
CREATE UNIQUE INDEX products_sku_unique     ON app.products (business_id, sku) WHERE sku IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX address_one_default     ON app.customer_addresses (customer_id) WHERE is_default AND archived_at IS NULL;

-- Search
CREATE INDEX customers_name_trgm ON app.customers USING gin (name gin_trgm_ops);

-- Lock the schema away from Supabase's public API roles (defence in depth)
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
-- Enable RLS on every app table with NO policies: anon/authenticated get nothing.
-- The API connects as the table owner (the role that ran migrations), which bypasses RLS.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
```

Re-run the `ENABLE ROW LEVEL SECURITY` step in any migration that adds a table. A CI check (Section 13.3) fails if any table in `app` has RLS disabled.

---

## 9. API Specification

Base path: `/api/v1`. Every request except `/health` requires `Authorization: Bearer <Supabase access token>`.

### 9.1 Session, onboarding, and business

Sign-up, login, logout, email verification, and password reset are handled in the browser by `supabase-js` against Supabase Auth. The API does not expose password endpoints.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/me` | Current user, membership, and business summary. Returns `needsOnboarding: true` if no business exists. |
| POST | `/onboarding` | Create `users` row (if missing), business, counter, and `OWNER` membership in one transaction. Idempotent per user. |
| GET | `/business` | Read active business profile |
| PATCH | `/business` | Update business profile (name, phone, prefix, default delivery fee, timezone) |
| GET | `/health` | Liveness/readiness; no auth; reveals no configuration |

### 9.2 Customers and addresses

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/customers?q=&page=&pageSize=` | Search by name/phone, paginate |
| POST | `/customers` | Create customer (optionally with first address) |
| GET | `/customers/:id` | Customer, addresses, order count, last order date |
| GET | `/customers/:id/orders` | Paginated order history |
| PATCH | `/customers/:id` | Update customer |
| POST | `/customers/:id/archive` | Archive customer |
| POST | `/customers/:id/addresses` | Add address |
| PATCH | `/customers/:id/addresses/:addressId` | Update address / set default |
| POST | `/customers/:id/addresses/:addressId/archive` | Archive address |

### 9.3 Products

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/products?q=&includeArchived=` | Search by name/SKU, paginate |
| POST | `/products` | Create product |
| GET | `/products/:id` | Read product |
| PATCH | `/products/:id` | Update product |
| POST | `/products/:id/archive` | Archive product |

### 9.4 Orders

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/orders` | Filtered, paginated order list |
| POST | `/orders` | Create order transactionally (`Idempotency-Key` required) |
| GET | `/orders/:id` | Order with items, delivery, payment summary |
| PATCH | `/orders/:id` | Edit permitted fields (Section 7.4) |
| POST | `/orders/:id/status` | Body `{ "to": "CONFIRMED", "reason"?: "" }` → transition validator |
| POST | `/orders/:id/cancel` | Cancel with required reason |
| GET | `/orders/:id/events` | Activity history |
| GET | `/orders/:id/payments` | Payment and refund records |
| POST | `/orders/:id/payments` | Record payment or refund (`Idempotency-Key` required) |
| PATCH | `/orders/:id/delivery` | Update recipient/address (before dispatch), courier, tracking, COD amount, notes |
| POST | `/orders/:id/delivery/dispatch` | `PENDING`/`FAILED` → `DISPATCHED` |
| POST | `/orders/:id/delivery/delivered` | → `DELIVERED`; order → `COMPLETED`; COD → `COLLECTED` |
| POST | `/orders/:id/delivery/failed` | → `FAILED` with reason |
| POST | `/orders/:id/delivery/returned` | → `RETURNED`; order → `RETURNED` |
| POST | `/orders/:id/cod/settle` | `COLLECTED` → `SETTLED`; creates COD payment (`Idempotency-Key` required) |
| POST | `/cod/settle` | Bulk settle (should-have): `{ orderIds: [], settledAt }` |
| GET | `/dashboard/summary?from=&to=` | Dashboard figures (Section 15) |
| GET | `/reports/sales?from=&to=` | Date-range sales report |
| GET | `/exports/orders.csv?…filters` | Export authorized orders |

Delivery changes use named action endpoints instead of a generic "set status" so each action can check its own preconditions.

### 9.5 Example list query

`GET /api/v1/orders?page=1&pageSize=25&orderStatus=READY&deliveryStatus=DISPATCHED&sourceChannel=WHATSAPP&from=2026-10-01&to=2026-10-31`

Requirements:
- Maximum `pageSize` 100.
- `from`/`to` are `YYYY-MM-DD` dates in the business timezone; `to` is inclusive and converted to an exclusive next-day UTC boundary (`[from 00:00 local, to+1 00:00 local)`).
- Validate date format and that `from ≤ to`; maximum range 366 days.
- Response: `{ "items": [...], "page": 1, "pageSize": 25, "total": 312 }`.
- Business scope comes from the authenticated membership. The API never accepts a `businessId` from the client.

### 9.6 Example create-order payload

```json
{
  "sourceChannel": "WHATSAPP",
  "fulfilmentType": "DELIVERY",
  "customerId": "uuid",
  "items": [
    { "productId": "uuid", "quantity": 2, "unitPrice": "1500.00" },
    { "name": "Gift wrapping", "quantity": 1, "unitPrice": "200.00" }
  ],
  "discountAmount": "100.00",
  "deliveryFee": "350.00",
  "paymentMethod": "COD",
  "initialPayment": { "amount": "0.00" },
  "delivery": {
    "sourceAddressId": "uuid",
    "recipientName": "Customer",
    "phone": "+94770000000",
    "addressLine1": "Example address",
    "city": "Colombo",
    "district": "Colombo",
    "saveToCustomer": false
  },
  "notes": "Deliver on Saturday"
}
```

Placeholder values. The server, in one transaction:
1. Verifies the customer, products, and address belong to the business (composite FKs also enforce this).
2. Takes product name and SKU from the database; uses the client's `unitPrice` if given (price override is allowed and recorded), otherwise the product's `selling_price`.
3. Calculates line totals, subtotal, and total; rejects a client-supplied `totalAmount`.
4. Allocates the order number from `business_counters`.
5. Inserts the order, items, delivery row (with COD amount and status), the optional initial payment, and recalculates payment status.
6. Writes `ORDER_CREATED` (and `PAYMENT_RECORDED` if any) events.
7. Stores the response against the `Idempotency-Key`.

### 9.7 API response conventions

- `200 OK`: successful read/update/action.
- `201 Created`: resource created.
- `400 Bad Request`: malformed input or validation failure (`VALIDATION_ERROR` with `fieldErrors`).
- `401 Unauthorized`: missing, invalid, or expired token.
- `403 Forbidden`: authenticated but role not permitted.
- `404 Not Found`: missing **or belongs to another business** (never reveal which).
- `409 Conflict`: duplicate, idempotency key reused with a different body, or concurrent state change.
- `422 Unprocessable Entity`: business-rule violation, e.g. `INVALID_TRANSITION`, `PAYMENT_EXCEEDS_BALANCE`, `REFUND_EXCEEDS_PAID`, `ORDER_TOTAL_BELOW_PAID`, `ORDER_LOCKED_AFTER_DISPATCH`.
- `429 Too Many Requests`: rate limit.
- `500 Internal Server Error`: generic message only.

Error shape:
```json
{ "code": "VALIDATION_ERROR", "message": "Please check the highlighted fields.", "fieldErrors": { "items[0].quantity": "Must be at least 1" }, "requestId": "…" }
```

### 9.8 API quality requirements

- Validate bodies, path parameters, and query parameters with DTOs and NestJS `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`).
- OpenAPI/Swagger generated from DTOs; available only in non-production.
- Rate limits (NestJS throttler): 300 requests/min per user generally; 10 exports/hour per business. Supabase Auth applies its own limits to sign-in and password reset.
- `Idempotency-Key` (UUID from the browser) required on `POST /orders`, `POST /orders/:id/payments`, `POST /orders/:id/cod/settle`. Same key + same body returns the stored response; same key + different body returns `409`.
- Transactions for all multi-table writes.
- Return only fields needed by the client; money as strings.
- Paginate every list.
- No hard delete for orders, payments, or events.
- Never log `Authorization` headers, tokens, or request bodies containing personal data.

---

## 10. Architecture and Technology

### 10.1 Stack

**Frontend**
- React + TypeScript + Vite
- Tailwind CSS
- React Router
- React Hook Form + Zod
- TanStack Query
- `@supabase/supabase-js` — authentication only

**Backend**
- Node.js LTS (pin the major version in `.nvmrc` and `engines`)
- NestJS + TypeScript
- Prisma ORM
- `decimal.js` for money, `libphonenumber-js` for phones
- `jose` for verifying Supabase JWTs
- OpenAPI/Swagger

**Database and auth**
- Supabase: managed PostgreSQL + Supabase Auth

**Testing and delivery**
- Jest (NestJS default) or Vitest for unit tests; Supertest for API integration tests
- Playwright (end-to-end)
- ESLint + Prettier
- GitHub Actions
- Supabase CLI for local database and auth (`npx supabase start`)

**Package manager: npm workspaces.** Commit `package-lock.json`; CI uses `npm ci`. Pin exact versions of Prisma, NestJS, and supabase-js at setup and upgrade deliberately.

### 10.2 Architecture

Modular monolith:
- One frontend (static build).
- One NestJS API service.
- One Supabase project per environment (database + auth).
- Supabase Auth sends verification and password-reset emails (configure a custom SMTP provider before launch; Supabase's built-in email is for testing only and heavily rate-limited).
- No microservices, queues, or Kubernetes in MVP.

Request flow:

```
Browser ──(sign in)──▶ Supabase Auth ──▶ access token (JWT)
Browser ──(Bearer JWT)──▶ NestJS API ──(verify JWT via JWKS)──▶ load membership
                                    └──(Prisma, server-only credentials)──▶ Supabase Postgres (schema app)
```

Backend modules: `auth` (JWT guard + membership), `users`, `businesses`, `onboarding`, `customers`, `products`, `orders` (incl. calculator, transitions, numbering), `payments`, `deliveries`, `dashboard`, `reports`, `exports`, `idempotency`, `common`, `subscriptions` (deferred).

### 10.3 Repository structure

```text
social-seller-order-manager/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/            # routes, layout, providers
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── onboarding/
│   │       │   ├── dashboard/
│   │       │   ├── orders/
│   │       │   ├── customers/
│   │       │   ├── products/
│   │       │   └── settings/
│   │       └── lib/            # api client, supabase client, formatters
│   └── api/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── src/
│           ├── auth/
│           ├── onboarding/
│           ├── businesses/
│           ├── customers/
│           ├── products/
│           ├── orders/
│           ├── payments/
│           ├── deliveries/
│           ├── dashboard/
│           ├── reports/
│           ├── exports/
│           ├── idempotency/
│           └── common/
├── packages/
│   └── shared/                 # API types, enums, stage labels, Zod schemas
├── supabase/
│   └── config.toml             # local Supabase CLI config
├── tests/
│   └── e2e/                    # Playwright
├── docs/
│   ├── DEVELOPMENT.md
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── RESTORE.md
│   └── adr/
├── .env.example
├── .nvmrc
├── package.json                # "workspaces": ["apps/*", "packages/*"]
├── package-lock.json
└── README.md
```

Prisma lives inside `apps/api` because only the API talks to the database. `packages/shared` contains request/response types and enums, not Prisma models.

Common commands:
```bash
npm install                         # install all workspaces
npm run dev -w apps/api             # start API
npm run dev -w apps/web             # start web
npx -w apps/api prisma migrate dev  # create/apply local migration
npm test --workspaces               # run all unit tests
```

### 10.4 Environment variables

`.env.example` with names and safe placeholders only:

**API (`apps/api/.env`)**
- `NODE_ENV`, `PORT`, `LOG_LEVEL`
- `DATABASE_URL` — runtime connection through the Supabase pooler (used by the `PrismaPg` adapter)
- `DIRECT_URL` — session-level connection used by the Prisma CLI via `prisma.config.ts` (session pooler or direct connection)
- `SUPABASE_URL` — used to fetch the JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
- `SUPABASE_JWT_ISSUER` — `${SUPABASE_URL}/auth/v1`
- `WEB_ORIGIN` — exact CORS origin
- `SENTRY_DSN` (or chosen error monitor)

**Web (`apps/web/.env`)** — public values only:
- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the public/publishable key)

Rules:
- The Supabase **service-role / secret key is not needed** by this design. Do not put it in any environment unless a specific server task requires it, and never in the web app.
- Validate required variables at API startup (Zod) and fail fast.
- Separate Supabase projects and credentials for local, staging, and production.

**Supabase connections (verify against current Supabase docs at setup):**
- The API is a long-running server, so use the **Supavisor session pooler** (IPv4-compatible) or the direct connection if the host supports IPv6. If the transaction pooler (port 6543) is used, add `pgbouncer=true` to `DATABASE_URL`.
- Migrations need a session-level connection (`DIRECT_URL`), not the transaction pooler.
- Keep the adapter's pool small (`max: 5`) so the API stays within the plan's connection limits.

---

## 11. Security, Privacy, and Reliability

### 11.1 Tenant isolation — mandatory

Every tenant-owned query is scoped to the business from the verified membership:

```ts
// AuthGuard sets req.auth = { userId, businessId, role } from the verified JWT + business_members
const order = await prisma.order.findFirst({
  where: { id: orderId, businessId: auth.businessId },
});
if (!order) throw new NotFoundException();
```

Layers of protection:
1. **Application:** every service method takes `businessId` from `req.auth`, never from the request body or query. Repository helpers require it as a parameter.
2. **Database:** composite foreign keys `(business_id, …)` prevent cross-tenant links even if application code has a bug.
3. **Supabase exposure:** the `app` schema is not exposed to the Data API, `anon`/`authenticated` roles have no grants, and RLS is enabled with no policies.
4. **Tests:** cross-tenant tests for every endpoint (Section 12.4).

Apply to reads, updates, archives, nested items/payments/deliveries/events, lookups, dashboard aggregates, exports, reports, and background jobs. UUIDs are identifiers, not authorization.

### 11.2 Authentication — Supabase Auth

- Email + password sign-up with **email confirmation required**.
- Password reset via Supabase's email link flow; the reset page lives in the web app.
- Minimum password length 8; enable Supabase's leaked-password protection if available on the plan.
- Configure allowed redirect URLs to the exact web origins per environment.
- Configure custom SMTP before the pilot.
- Session: `supabase-js` stores the session in the browser and refreshes the access token automatically. Keep access token lifetime at the default (about 1 hour).

**API token verification:**
- `AuthGuard` reads the Bearer token and verifies it with `jose`: signature against Supabase's JWKS (asymmetric signing keys), `iss` = `SUPABASE_JWT_ISSUER`, `aud` = `authenticated`, and expiry. Cache the JWKS.
- If the Supabase project still uses the legacy shared HS256 secret, migrate it to asymmetric signing keys before staging; do not ship with the shared secret in the API.
- After verification, load `business_members` for `sub`. No membership → `403` except on `/me` and `/onboarding`.
- `users.disabled_at` set → `403`.

Because the API uses Bearer tokens (not cookies), CSRF protection is not needed. The trade-off is that tokens in browser storage are exposed to XSS, so a strict Content Security Policy and no `dangerouslySetInnerHTML` are required.

### 11.3 Supabase hardening

- Application tables only in schema `app`; leave `app` out of "Exposed schemas" in the Data API settings. Optionally disable the Data API entirely.
- `REVOKE` all on `app` from `anon` and `authenticated`; RLS enabled on all `app` tables with no policies.
- Do not create tables in `public`. Run Supabase's Security Advisor before each release and resolve warnings.
- Enable MFA for all Supabase dashboard accounts; limit dashboard access to named people.
- Use separate database passwords per environment; rotate if exposed.
- Restrict direct database access with Supabase network restrictions where the plan allows.

### 11.4 Application security

- Validate all inputs on the server.
- Prisma parameterized queries only; any raw SQL uses tagged templates (`$queryRaw`) — never string concatenation.
- Exact CORS origin (`WEB_ORIGIN`); no wildcard.
- Security headers via `helmet`; CSP on the web host.
- Request body limit 100 KB.
- Rate limits on exports and writes.
- CSV: prefix values starting with `=`, `+`, `-`, `@`, tab, or carriage return with `'`.
- No stack traces in production responses.
- `npm audit` and Dependabot alerts in CI.

### 11.5 Data protection

Data includes customer names, phone numbers, addresses, sales, and payment references.
- Collect only what is necessary.
- Publish privacy terms and a retention policy before the pilot.
- Avoid logging personal data; mask phones in logs.
- Provide data export and account closure. Closure: business archived immediately, data deleted after 30 days, then ages out of backups by the backup retention period (documented to the seller).
- Review Sri Lanka's Personal Data Protection Act requirements and cross-border hosting implications with qualified advice. Supabase hosting will be outside Sri Lanka; disclose this in the privacy policy.
- Document incident response and seller notification steps.

### 11.6 Backups and recovery

- **Pilot and production run on a paid Supabase plan** that includes daily backups and does not pause inactive projects. Verify the current plan details at setup.
- **RPO:** 24 hours for the pilot (daily backups). Before paid launch, evaluate Point-in-Time Recovery to reduce RPO to minutes.
- **RTO:** 4 hours.
- **Independent copy:** a nightly GitHub Actions job runs `pg_dump` of schema `app` (using the Supabase CLI or `pg_dump` against `DIRECT_URL`), encrypts it, and stores it outside Supabase with 30-day retention.
- `docs/RESTORE.md` describes restoring both from Supabase backups and from the independent dump into a fresh project.
- Test a full restore before the pilot and every quarter afterward. A successful backup job is not proof that restore works.
- Migrations are forward-only; rollback = deploy a new corrective migration. Destructive changes use expand → migrate data → contract across releases.

### 11.7 Observability

- Structured JSON logs (`pino`) with request ID.
- `/health` endpoint (process up + database ping), no secrets.
- Error monitoring (e.g. Sentry) on API and web, with personal data scrubbing.
- Supabase usage dashboard: database size, connections, auth emails.
- Uptime monitor on `/health` alerting the founder by email/phone.
- Define who responds to alerts and within what time during the pilot.

---

## 12. Testing Plan

### 12.1 Unit tests

- Order calculator: subtotal, discount limits, delivery fee, total, rounding.
- Payment summary: all five payment statuses, overpayment rejection, refund limits.
- Order, delivery, and COD transition tables (every allowed and disallowed pair).
- Display stage derivation.
- Edit-lock rules.
- Order-number formatting and prefix validation.
- Phone normalization (Sri Lankan formats, invalid numbers).
- Date range → UTC boundary conversion in `Asia/Colombo`.
- CSV formula-injection escaping.
- JWT guard: valid, expired, wrong issuer, wrong audience, bad signature.

### 12.2 Integration tests

Run against a real PostgreSQL database (Supabase CLI local stack or a Postgres service container in CI) with migrations applied:
- Onboarding transaction and idempotency.
- Customer/product create, update, archive.
- Order creation with items, delivery, initial payment.
- Rollback when any step fails (no order, no number consumed visible).
- Payment, refund, overpayment rejection, payment-status recalculation.
- Dispatch → delivered → COD collected → settled creates exactly one payment.
- Status changes write events.
- `CHECK` constraints and composite FKs reject bad data even when called directly.
- Search, pagination, filtering, export.
- 20 concurrent order creations for one business → 20 unique sequential numbers.
- Idempotency: same key twice → one order.

### 12.3 End-to-end tests (Playwright)

1. Sign up, confirm email (local Supabase Inbucket/Mailpit), complete onboarding.
2. Create customer and product.
3. Create a WhatsApp COD delivery order.
4. Confirm it appears in the list with the right stage.
5. Confirm → Ready → Dispatch → Delivered.
6. Settle COD; payment status becomes `PAID`.
7. Create a pickup order with partial bank-transfer payment; complete it.
8. Cancel an order with a payment; record refund.
9. Check dashboard figures and order history.
10. Export CSV.
11. Repeat the order-creation flow at 360px width.
12. Sign out; protected routes redirect to login.

### 12.4 Security tests

- Use business A's token with business B's order/customer/product/address IDs on every endpoint → `404`.
- Create an order in A referencing B's customer/product/address → rejected.
- Send `businessId` in bodies/queries → ignored or rejected.
- Expired, tampered, and wrong-project tokens → `401`.
- Call Supabase's REST endpoint with the anon key for `app` tables → no access.
- Replay payment requests with the same idempotency key → one payment.
- Oversized payloads and invalid filters → `400`.
- Logs contain no tokens or full phone numbers.

### 12.5 Release gate

Do not release to real sellers until:
- Critical flows pass.
- Tenant isolation tests pass.
- Money and status logic is fully covered by tests.
- Migrations run cleanly on a fresh database.
- RLS check passes for every `app` table.
- Backup restore has been tested.
- Production secrets, HTTPS, custom SMTP configured.
- Error monitoring and support contact are available.

---

## 13. Deployment and CI/CD

### 13.1 Hosting

| Component | Choice | Notes |
|---|---|---|
| Database + Auth | **Supabase** | Region: Singapore (`ap-southeast-1`) or Mumbai if offered — pick the lowest latency to Sri Lanka and put the API in the same region. Paid plan from pilot onward. |
| API | Managed Node host in the same region (e.g. Render, Railway, or Fly.io) | Paid instance that does not sleep. Must reach Supabase over IPv4 (session pooler) unless IPv6 is supported. |
| Web | Static host (e.g. Cloudflare Pages, Netlify, or Vercel) | Confirm the plan allows commercial use (Vercel Hobby does not). |
| CI | GitHub Actions | |
| Email | Custom SMTP provider configured in Supabase Auth | e.g. Resend, Postmark, Amazon SES |
| Domain | Custom domain before pilot | `app.<domain>` for web, `api.<domain>` for API |

Check current terms, quotas, regions, and prices before choosing; they change.

### 13.2 Environments

**Local**
- `npx supabase start` runs Postgres, Auth, and a mail catcher in Docker.
- Fake seed data from `apps/api/prisma/seed.ts`.
- `.env` files ignored by Git.

**Staging**
- Separate Supabase project and API/web deployments.
- Fake or consented test data only.
- Deployed automatically from `main`.

**Production**
- Separate Supabase project (paid plan), HTTPS, backups, monitoring.
- Migrations applied by a manual-approval CI job.

Never copy production customer data into local or staging.

### 13.3 CI pipeline

For each pull request:
1. `npm ci`.
2. `npm run lint` and `npm run format:check`.
3. `npm run typecheck --workspaces`.
4. Unit tests.
5. Start PostgreSQL service container; `npx -w apps/api prisma migrate deploy`; run integration tests.
6. Check that every table in schema `app` has RLS enabled.
7. `npx -w apps/api prisma validate` and fail if the schema has changes without a migration (`prisma migrate diff`).
8. Build web and API.
9. `npm audit --audit-level=high`.

For deployment:
1. Merge approved PR to `main`.
2. Build artifacts.
3. Apply migrations to staging; deploy staging.
4. Run smoke tests and Playwright against staging.
5. Manual approval → apply migrations to production (`prisma migrate deploy` with `DIRECT_URL`).
6. Deploy API, then web.
7. Verify `/health` and a smoke order in a test business.
8. Roll back by redeploying the previous build; schema fixes go forward with a new migration.

### 13.4 Cost stages

- **Prototype:** local Supabase CLI + free tiers.
- **Pilot:** paid Supabase plan (backups, no pausing), small paid API instance, free/cheap static hosting, SMTP free tier.
- **Production:** add PITR evaluation, monitoring, domain, support time.

Do not promise zero-cost hosting. Review costs monthly.

---

## 14. Pricing and Monetization Hypotheses

These are hypotheses to test, not validated prices.

| Plan | Price (test) | Orders/month | Includes |
|---|---|---|---|
| Free | LKR 0 | 30 | Orders, customers, products, one owner, basic dashboard |
| Starter | ~LKR 990 | 300 | + payment/COD tracking, CSV export |
| Growth | ~LKR 1,990 | Fair use | + reports, staff access (when built), priority support |

- **Pilot:** all pilot sellers get Starter features free; limits are not enforced.
- Limits are enforced on the server and count orders by `created_at` in the business timezone month.
- Over the limit: creating new orders is blocked with an upgrade message. Viewing, editing, payments, deliveries, and export of existing data **always** keep working.
- Subscription payments in the pilot: manual bank transfer and manual activation. Evaluate local payment gateways (merchant eligibility, recurring billing, fees) before automating. Never store card data.
- Validate pricing with real payments, not survey answers.

---

## 15. Analytics Definitions

Implemented once in `apps/api/src/dashboard/metrics.ts`. "Period" means `[from, to]` local dates in the business timezone.

| Metric | Definition |
|---|---|
| Orders created | Count of orders with `created_at` in period, including cancelled. |
| Orders needing action | `order_status IN (NEW, PENDING_CONFIRMATION)`. |
| Ready to send | `order_status = READY` and delivery `PENDING` (or pickup not yet completed). |
| Out for delivery | Delivery `status = DISPATCHED`. |
| Delivered | Deliveries with `delivered_at` in period. |
| Order value | Sum of `total_amount` for orders created in period, excluding `CANCELLED`. Not called "revenue". |
| Payments received | Sum of `PAYMENT` records with `occurred_at` in period. |
| Refunds | Sum of `REFUND` records with `occurred_at` in period. |
| Net received | Payments received − refunds. |
| Outstanding balance | Sum of `total_amount − (amount_paid − amount_refunded)` for orders not `CANCELLED`/`RETURNED`, where positive. |
| COD out for delivery | Sum of `cod_amount` where `cod_status = PENDING` and delivery `DISPATCHED`. |
| COD with courier | Sum of `cod_amount` where `cod_status = COLLECTED`. |
| Refunds owed | Sum of `amount_paid − amount_refunded` for `CANCELLED`/`RETURNED` orders, where positive. |
| Cancellation rate | Cancelled ÷ orders created, same period cohort. |

A delivered COD order is not money received until it is settled.

---

## 16. Development Roadmap

Planning estimate for one developer.

### Week 1 — Discovery and prototype
- Interview sellers (including COD remittance questions).
- Confirm problem and manual-entry willingness.
- Clickable prototype of order entry and order details.
- Review prototype with sellers.

**Deliverable:** approved MVP scope and prototype.

### Week 2 — Foundation
- npm workspaces monorepo, lint, format, typecheck.
- Supabase CLI local stack; staging Supabase project in chosen region.
- Prisma schema + initial migration with hand-written SQL (Section 8.5).
- JWT guard, `/me`, onboarding.
- CI pipeline.

**Deliverable:** secure skeleton; user can sign up and land on an empty dashboard.

### Week 3 — Customers and products
- APIs and UI, search, archive, phone normalization.
- Tenant-isolation tests.

### Weeks 4–5 — Orders
- Order calculator, numbering, idempotency.
- Create/edit form, list, filters, details, transitions, events.

### Week 6 — Payments, delivery, COD
- Payments/refunds and payment status.
- Delivery actions, COD lifecycle and settlement.
- Copyable messages; cancellation and returns.

### Week 7 — Dashboard and export
- Dashboard metrics, sales report, CSV export.
- Mobile polish; empty/error states.

### Week 8 — Hardening
- Full test suites; security review; Supabase Security Advisor.
- Production Supabase project, custom SMTP, monitoring.
- Backup + restore test; independent dump job.
- Privacy policy, terms, onboarding help, support channel.

**Deliverable:** pilot-ready release.

### Weeks 9–10 — Pilot
- Onboard 3–5 sellers; observe and fix.
- Test paid plans.
- Decide launch / narrow / revise.

---

## 17. Milestones

Build a thin vertical slice first.

- **A — Secure foundation:** sign-up/onboarding works; API verifies tokens; requests scoped to business; cross-tenant tests and RLS check pass.
- **B — First order:** add customer and product; create order; server totals and number; see it in list and details.
- **C — Order operations:** status changes, payments/refunds, delivery actions, COD settlement, history.
- **D — Daily usability:** search, filters, dashboard, export, mobile.
- **E — Production readiness:** security tests, monitoring, restore test, policies, production deploy.

A milestone is complete only when tests and acceptance criteria pass.

---

## 18. Known Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Sellers will not manually enter orders | Validate early; optimize entry flow; quick-add; reconsider integrations only with evidence. |
| Market is too broad | Pilot across categories; focus on the segment with the strongest pain. |
| Sellers expect automatic social imports | State scope clearly; do not promise integrations. |
| Customer data leak | Four-layer tenant isolation (Section 11.1), private `app` schema, careful logging. |
| Supabase Data API exposes tables | Private schema, revoked grants, RLS on, CI check, Security Advisor. |
| Financial figures disagree | One calculator and one payment-summary function; Decimal money; tests. |
| COD mistaken for money received | Separate `cod_status`; payment created only at settlement; separate dashboard figures. |
| Status fields drift apart | Each status stored once; automatic changes in the same transaction; derived stage label. |
| Duplicate orders on weak networks | Idempotency keys; disabled submit button; duplicate-order warning. |
| Free tier pauses or lacks backups | Paid Supabase plan from pilot; independent nightly dump. |
| Hosting terms prohibit commercial use | Check terms before choosing. |
| Connection limits exceeded | Supabase pooler + small adapter pool (`max: 5`); monitor. |
| Scope creep | Explicit out-of-scope list; pilot evidence decides. |
| Data loss | Daily backups, independent dump, quarterly restore tests. |

---

## 19. Version 1.2 Candidates — Only After Validation

1. Repeat-order duplication and faster entry.
2. Customizable message templates.
3. Courier fee and remittance tracking (net settlement).
4. `delivery_attempts` table for detailed retry history.
5. Staff accounts (`STAFF` role) and simple permissions.
6. Inventory and low-stock alerts.
7. Better reports.
8. Customer import/export.
9. Sinhala and Tamil UI.
10. Courier integrations.
11. WhatsApp messaging through approved provider APIs.
12. Social platform integrations, subject to API permissions.
13. Subscription billing automation.
14. PWA installability.
15. Social login through Supabase Auth.

Rank by observed frequency, impact, cost, maintenance, and willingness to pay.

---

## 20. Final Release Checklist

### Product
- [ ] Scope matches the MVP.
- [ ] Pilot acceptance criteria documented.
- [ ] Onboarding is understandable.
- [ ] Order flow works on a phone.
- [ ] Out-of-scope features are not advertised.

### Data and business rules
- [ ] Totals calculated on the server.
- [ ] Payment/refund/overpayment logic tested.
- [ ] Each status stored in one place; automatic transitions tested.
- [ ] COD lifecycle tested end to end.
- [ ] Order snapshots preserve history.
- [ ] Order-number concurrency tested.
- [ ] Dashboard definitions documented and tested.

### Security
- [ ] Cross-business tests pass on every endpoint.
- [ ] `app` schema not exposed; grants revoked; RLS enabled on all tables.
- [ ] Supabase Security Advisor clean.
- [ ] JWT verification uses asymmetric keys, issuer, audience.
- [ ] No secrets committed; no service-role key in web app.
- [ ] HTTPS, CSP, exact CORS.
- [ ] Rate limits configured.
- [ ] Logs avoid personal data.
- [ ] Export is tenant-scoped and CSV-safe.

### Reliability
- [ ] Migrations work on a clean database.
- [ ] Unit, integration, e2e tests pass.
- [ ] Health checks, uptime, error monitoring configured.
- [ ] Supabase backups confirmed; independent dump running.
- [ ] Restore tested.

### Operations and business
- [ ] Privacy policy and terms published (incl. hosting location).
- [ ] Custom SMTP configured; password reset works.
- [ ] Support process exists.
- [ ] Hosting terms allow commercial use.
- [ ] Costs and quotas reviewed.
- [ ] Pilot sellers agreed.
- [ ] Pricing tested with real payment intent.

---

## 21. Decisions (Architecture Decision Records)

Each decision gets a file in `docs/adr/` with context, options, decision, reason, consequences, and date. Summary:

| ADR | Decision | Choice | Reason |
|---|---|---|---|
| 001 | Database hosting | **Supabase PostgreSQL** | Managed Postgres, backups, local CLI, auth in the same platform. |
| 002 | Package manager | **npm workspaces** | Team preference; no extra tooling. `package-lock.json` committed. |
| 003 | Authentication | **Supabase Auth**; API verifies JWT via JWKS | No password handling in our code; email verification and reset included. |
| 004 | DB exposure | Private `app` schema, revoked grants, RLS on with no policies; API-only access | Supabase's Data API must not expose tenant data. |
| 005 | Order statuses | Order = seller workflow; delivery status only on `deliveries`; derived stage label | Removes duplicated states that could drift. |
| 006 | Payment status | Stored + cached sums, recalculated from `payments` in the same transaction | Filterable and indexable, without drift. |
| 007 | COD | `cod_status` lifecycle; payment created on settlement | Expected money ≠ received money. |
| 008 | Discounts | Order-level fixed amount only | Simplest model; no double discounting. |
| 009 | Customer requirement | Required except anonymous `WALK_IN` + `PICKUP` | Keeps history useful; allows counter sales. |
| 010 | Order numbers | Per-business prefix, `{PREFIX}-{0001}`, counter table, no annual reset | Short, unique, concurrency-safe. |
| 011 | Money | `NUMERIC(12,2)` + Prisma `Decimal` + `decimal.js`; strings in JSON | Exact decimal maths. |
| 012 | Deliveries | One row per delivery order; `attempt_count`; history in events | Simple MVP; attempts table later. |
| 013 | Address snapshots | Copied onto `deliveries` at creation; optional "save to customer" | History never changes. |
| 014 | Refunds/overpayment | Overpayment rejected; refunds ≤ net paid; no automatic refunds; insert-only records | Clear, auditable money trail. |
| 015 | Dates/timezone | Store UTC; business timezone `Asia/Colombo`; inclusive local date filters → exclusive UTC bounds | Correct "today" for sellers. |
| 016 | Phones | `libphonenumber-js`, default `LK`, E.164 normalized + display copy | Reliable search without guessing. |
| 017 | Idempotency | Required key on order, payment, COD settlement endpoints | Weak mobile networks retry. |
| 018 | Backups | Paid Supabase plan daily backups + nightly independent dump; RPO 24h, RTO 4h for pilot | Restorable even if the provider has an issue. |
| 019 | Plan limits | Block new orders only; never block access to existing data | Sellers keep their records. |

Still open (decide before the pilot):
- [ ] API host and web host (pick from Section 13.1 after checking current terms).
- [ ] Supabase region (latency test from Sri Lanka).
- [ ] SMTP provider.
- [ ] Error-monitoring provider.
- [ ] Pilot start date and success criteria sign-off.

---

## 22. First GitHub Issues

Create in order; each with acceptance criteria:

1. Initialize npm workspaces monorepo with lint, format, typecheck, `.nvmrc`.
2. Add Supabase CLI local stack and environment validation.
3. Add Prisma schema, initial migration, and hand-written constraints/RLS SQL.
4. Implement JWT auth guard (JWKS) and `/me`.
5. Implement onboarding (user, business, counter, owner membership).
6. Add tenant-scoped request context and repository pattern + isolation test helper.
7. Customers and addresses (API + UI) with phone normalization.
8. Products (API + UI) with archive.
9. Order calculator and unit tests.
10. Order-number allocation with concurrency test.
11. Idempotency middleware.
12. Transactional order creation (API).
13. Order form UI (mobile-first).
14. Order list, search, filters, pagination.
15. Order details, editing rules, events timeline.
16. Order status transitions and display stage.
17. Payments, refunds, payment summary recalculation.
18. Delivery actions and COD lifecycle, including settlement.
19. Dashboard metrics endpoint and UI.
20. CSV export with tenant scoping and formula-injection protection.
21. Copyable message templates.
22. Playwright e2e suite.
23. CI: RLS check, migration drift check, audit.
24. Staging deployment (Supabase project, API, web, SMTP).
25. Monitoring, backups, independent dump, restore test.
26. Security review and Supabase Security Advisor.
27. Onboard pilot sellers and record results.

---

## 23. Working Rules for AI-Assisted Development

1. Inspect the current repository before changing files.
2. Work on one issue or vertical slice at a time.
3. List files to change before broad refactors.
4. Require tests for business rules and tenant isolation.
5. Review every migration and dependency addition.
6. Never paste production secrets, Supabase keys, or real customer records into prompts.
7. Run the project and tests locally after each milestone.
8. Reject code that trusts `businessId`, totals, statuses, or permissions from the client.
9. Reject code that queries `app` tables from the browser via `supabase-js`.
10. Keep this document and the ADRs updated when approved behavior changes.
11. One logical change per commit.

### Recommended prompt template

> Read `docs/DEVELOPMENT.md` (this blueprint) and inspect the repository. Implement only issue [ID and title]. Do not refactor unrelated files. Follow the documented architecture, tenant isolation, validation, status, and money rules. First summarize the intended changes and files. Then implement, add unit/integration tests, run the relevant checks, and report files changed, tests run, limitations, and decisions needing approval. Do not invent credentials or modify production data.

---

## 24. References to Verify During Implementation

- React: https://react.dev/
- TypeScript: https://www.typescriptlang.org/docs/
- Vite: https://vite.dev/guide/
- NestJS: https://docs.nestjs.com/
- Prisma: https://www.prisma.io/docs (see the Supabase integration guide for your pinned version)
- PostgreSQL: https://www.postgresql.org/docs/
- Supabase docs: https://supabase.com/docs — connecting with Prisma, connection pooling (Supavisor), JWT signing keys, Auth SMTP, Data API exposed schemas, RLS, backups, Security Advisor
- Supabase CLI: https://supabase.com/docs/guides/local-development
- Supabase pricing: https://supabase.com/pricing
- npm workspaces: https://docs.npmjs.com/cli/using-npm/workspaces
- Playwright: https://playwright.dev/docs/intro
- GitHub Actions: https://docs.github.com/actions
- libphonenumber-js: https://gitlab.com/catamphetamine/libphonenumber-js
- jose: https://github.com/panva/jose

Provider plans, terms, and limits change. Verify before production use.

---

## 25. Closing Principle

The first objective is not to build the biggest system. It is to build a secure, reliable workflow that a real seller uses for real orders and is willing to pay for.

**Build in this order:** validate → prototype → secure foundation → customers/products → orders → payments/delivery/COD → dashboard/export → test → pilot → paid launch.

Treat this document as the baseline. Record decisions, keep scope controlled, and let pilot evidence determine what comes next.
