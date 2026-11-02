# ADR-013: Address snapshots: copied onto the delivery at creation

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.11, §8.2

## Context

Customers' saved addresses change over time. An order must keep showing where it was actually sent.

## Options considered

- **Reference the saved address**: history silently changes when the customer edits it.
- **Copy the address onto the delivery at creation**, with an optional "save to customer".

## Decision

The delivery row stores its own copy of the recipient, phone and address fields. `source_address_id` is informational only. A "Save address to customer" checkbox lets a newly typed address be saved to the customer's list.

## Reason

History never changes when catalogue or customer data changes (product principle 4).

## Consequences

- Editing a customer's address never touches existing orders.
- Event JSON records which fields changed, never the address or phone values themselves (§8.2).
