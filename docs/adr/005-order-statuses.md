# ADR-005: Order statuses: seller workflow on orders, delivery status only on deliveries, derived stage label

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.1, §7.2, §7.3

## Context

Blueprint v1.0 had `DISPATCHED`, `DELIVERED`, `FAILED_DELIVERY` and `RETURNED` in both the order status and the delivery status, stored on both `orders` and `deliveries`. Two copies of the same fact drift apart.

## Options considered

- **One combined status** for orders: simple, but mixes the seller's workflow with courier events, and pickup orders have no delivery.
- **Duplicated statuses on both tables** (v1.0): drift-prone.
- **Separate dimensions, each stored once, with automatic transitions between them, plus a derived display label.**

## Decision

- `orders.order_status` covers only the seller's workflow: NEW, PENDING_CONFIRMATION, CONFIRMED, PREPARING, READY, COMPLETED, CANCELLED, RETURNED.
- Delivery status lives **only** on `deliveries`, which exists for DELIVERY orders only.
- Delivery events move the order to COMPLETED or RETURNED automatically, in the same transaction.
- The UI shows one **stage label** derived from both (§7.3), implemented once in `packages/shared`.
- The client sends actions, never raw statuses.

## Reason

Each fact is stored in exactly one place (product principle 3), which removes the drift, while the derived label keeps the UI simple.

## Consequences

- Transition tables for order, delivery and COD status are data with validators and exhaustive tests (task C3).
- Every transition writes an `order_events` row.
- For DELIVERY orders, returns go through the delivery action. The order-level COMPLETED → RETURNED action is for PICKUP orders only.
