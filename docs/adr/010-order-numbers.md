# ADR-010: Order numbers: per-business prefix, {PREFIX}-{0001}, counter table

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.12, §8.2

## Context

Sellers say order numbers to customers on the phone and type them in WhatsApp. v1.0 used the same `SS-` prefix for every business. Numbers must be unique per business under concurrent creation.

## Options considered

- **UUIDs only**: unique, but unusable by people.
- **A global sequence**: reveals other businesses' volume.
- **A `MAX(order_number) + 1` query**: races under concurrency.
- **A per-business counter row incremented in the order transaction, with a per-business prefix.**

## Decision

Format `{PREFIX}-{N}`, with N zero-padded to at least 4 digits (NIM-0001, NIM-12345) and no annual reset.

- `PREFIX` is 2–6 uppercase letters or digits per business. It is suggested from the business name at onboarding (default ORD) and can be changed for future orders.
- Numbers come from `business_counters` via `UPDATE … SET next_order_seq = next_order_seq + 1 … RETURNING`, inside the order-creation transaction.
- `UNIQUE (business_id, order_number)` is the final guarantee. The UUID stays the primary key.

## Reason

Short, unique per business, and concurrency-safe through the row lock. Gaps after rollbacks are acceptable.

## Consequences

- The counter row is created at onboarding (task A16).
- `suggestOrderPrefix` and `formatOrderNumber` live in `packages/shared`, used by both API and web (the onboarding preview).
- A test of 20 concurrent creations is required (task C5).
