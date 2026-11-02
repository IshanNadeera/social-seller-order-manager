# ADR-006: Payment status: stored, always recalculated from payment records

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.6, §8.2

## Context

The order list must filter and index by payment status, and show paid and refunded amounts. Deriving these on every read is expensive for lists. Updating them incrementally risks drift from the payment records.

## Options considered

- **Derived on read** from `payments`: always correct, but slow to filter and impossible to index.
- **Stored and incremented** on each payment: fast, but drifts after any bug or concurrent write.
- **Stored, but recalculated from `payments` by one function** in the same transaction as any change.

## Decision

Store `payment_status`, `amount_paid` and `amount_refunded` on `orders`. They are written **only** by `recalculatePaymentSummary(tx, orderId)`:

- it locks the order row (`SELECT … FOR UPDATE`);
- it recomputes the totals from `payments`, never by incrementing;
- it runs inside the transaction of every payment, refund or total change.

## Reason

Filterable and indexable, without the drift of incremental updates. Correctness has a single owner.

## Consequences

- No other code may write these columns. Tests cover all five statuses (task C7).
- A `CHECK (amount_paid >= amount_refunded)` backs the rule in the database.
