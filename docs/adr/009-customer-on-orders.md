# ADR-009: Customer required on every order, except anonymous walk-in pickups

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.10, §8.2

## Context

v1.0 made `customer_id` optional but required a customer name snapshot, which was contradictory. Order history per customer is valuable, but counter sales often have no customer to record.

## Options considered

- **Always required**: forces fake customers for counter sales.
- **Always optional**: orders without customers weaken history and search.
- **Required except anonymous WALK_IN sales, which must be PICKUP.**

## Decision

`customer_id` is required unless `source_channel = WALK_IN`. Anonymous walk-in orders store `customer_name_snapshot = 'Walk-in customer'` with no phone, and must use PICKUP. Every order keeps its own snapshot of the customer's name and phone.

## Reason

Keeps customer history useful while allowing quick counter sales.

## Consequences

- Enforced in the database by `CHECK (customer_id IS NOT NULL OR source_channel = 'WALK_IN')`, plus the walk-in → pickup CHECK (ADR-023), and by API validation (task C8).
