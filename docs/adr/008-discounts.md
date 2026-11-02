# ADR-008: Discounts: one fixed amount per order

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.5

## Context

v1.0 allowed both line-level and order-level discounts, which allows double discounting and complicates totals, refunds and reports.

## Options considered

- **Line and order discounts** (v1.0): flexible, error-prone.
- **Line discounts only**: awkward for "Rs. 200 off the whole order".
- **One fixed-amount discount per order**, applied before the delivery fee.

## Decision

Only an **order-level fixed-amount discount**, with `0 ≤ discount_amount ≤ subtotal`, applied to the item subtotal before the delivery fee. There is no `line_discount` column. A seller who wants a cheaper item edits that line's unit price.

## Reason

It is the simplest model that covers how sellers discount, and it cannot be applied twice.

## Consequences

- `order_items` has no discount column. `CHECK (discount_amount >= 0 AND discount_amount <= subtotal)` enforces the rule.
- All money maths lives in `apps/api/src/orders/order-calculator.ts` (task C1).
