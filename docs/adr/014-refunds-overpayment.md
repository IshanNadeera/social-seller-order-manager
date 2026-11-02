# ADR-014: Refunds and overpayment: overpayment rejected, refunds limited, insert-only records

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.7

## Context

Sellers record partial payments, refunds and corrections. The money trail must stay auditable, and balances must never go negative.

## Options considered

- **Allow overpayment as customer credit**: needs a credit ledger, out of scope.
- **Edit or delete payment records to fix mistakes**: breaks the audit trail.
- **Reject overpayment, limit refunds to the net paid, and make records insert-only.**

## Decision

- A payment may not make the net paid exceed the total (`PAYMENT_EXCEEDS_BALANCE`).
- A refund may not exceed the current net paid (`REFUND_EXCEEDS_PAID`).
- No payments on CANCELLED or RETURNED orders; refunds are allowed.
- Cancelling or returning never refunds automatically: the UI prompts, and the order shows under "Refunds owed".
- Records are never edited or deleted. A mistake is fixed with a refund noted as a correction.
- `occurred_at` may be backdated up to 90 days.

## Reason

A clear, auditable money trail with no hidden credit balances.

## Consequences

- There are no update or delete endpoints for payments. `CHECK (amount > 0)` applies; the type gives the direction.
- Payment recording requires an `Idempotency-Key` (ADR-017).
