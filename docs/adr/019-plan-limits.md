# ADR-019: Plan limits: block new orders only, never access to existing data

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §14

## Context

Paid plans will cap orders per month. A seller who hits the cap still has customers waiting on existing orders.

## Options considered

- **Lock the account over the limit**: sellers lose access to their own records.
- **Soft warnings only**: no incentive to upgrade.
- **Block only creating new orders over the limit; keep everything else working.**

## Decision

Limits are enforced on the server, counting orders by `created_at` in the business time-zone month. Over the limit, order creation is blocked with an upgrade message. Viewing, editing, payments, deliveries and export of existing data always keep working. Limits are not enforced during the pilot.

## Reason

Sellers keep control of their records, and the limit still means something.

## Consequences

- Subscription tables and billing are deferred until the paid launch.
- Pilot billing is manual.
