# ADR-012: Deliveries: one row per delivery order; attempts counted, history in events

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8.2, §7.2

## Context

A delivery can fail and be re-attempted. Pickup orders have no delivery at all.

## Options considered

- **Delivery columns on `orders`**: nulls for pickups, and status duplication (ADR-005).
- **A `delivery_attempts` table now**: detailed, but more than the MVP needs.
- **One `deliveries` row per DELIVERY order, with an `attempt_count`, and each attempt recorded in `order_events`.**

## Decision

`deliveries` has at most one row per order (`order_id UNIQUE`), only for DELIVERY orders. It holds the recipient and address copy, courier, tracking, the COD fields, `attempt_count`, and the dispatch, delivery and failure details. Each attempt's history is in `order_events`.

## Reason

Simple for the MVP. A detailed attempts table can come later (§19, v1.2 candidate 4).

## Consequences

- Switching fulfilment type before dispatch creates or deletes the row, with an event (§7.4).
