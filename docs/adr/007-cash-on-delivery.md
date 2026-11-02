# ADR-007: Cash on delivery: COD status lifecycle; payment recorded only at settlement

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.8, §7.2, §15

## Context

With COD, money moves customer → courier → seller, usually days later and in batches. Treating a delivered COD order as paid overstates the cash the seller actually has.

## Options considered

- **Record a payment when the courier collects**: simple, but counts money the seller does not have.
- **Track COD outside the system**: loses the main pain point sellers report.
- **A separate `cod_status` lifecycle (NOT_APPLICABLE → PENDING → COLLECTED → SETTLED), with the payment created at settlement.**

## Decision

COD is allowed only for DELIVERY orders.

- `cod_amount` defaults to the balance due, is editable until dispatch, and is frozen at dispatch.
- DELIVERED → `cod_status = COLLECTED`. No payment is created yet.
- "Mark COD settled" with a date creates one PAYMENT (method COD) and sets `cod_status = SETTLED`, in one transaction.
- Courier fees are not tracked in the MVP.

## Reason

Expected money is never treated as received money (product principle 7).

## Consequences

- The dashboard keeps "COD out for delivery", "COD with courier" and "payments received" as separate figures (§15).
- COD settlement requires an `Idempotency-Key` (ADR-017). Bulk settlement is a should-have (task D8).
