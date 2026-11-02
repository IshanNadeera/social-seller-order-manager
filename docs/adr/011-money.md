# ADR-011: Money: NUMERIC(12,2), Prisma Decimal, decimal.js, strings in JSON

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.5, §8.1

## Context

Totals, balances and refunds must be exact. JavaScript `number` is a binary float and cannot represent amounts like 0.1 exactly.

## Options considered

- **Integer cents in `number`**: exact up to 2^53, but every display and input needs conversion, and mistakes are easy.
- **Floats**: inexact; ruled out.
- **`NUMERIC(12,2)` in the database, Prisma `Decimal`, `decimal.js` for maths, and strings in JSON.**

## Decision

Money is stored as `NUMERIC(12,2)`, read as Prisma `Decimal`, calculated with `decimal.js`, and sent in JSON as strings ("1500.00").

- Amounts are at most 99,999,999.99.
- Rounding is half-up to 2 decimals, at line level only.
- One module does all money calculations.

## Reason

Exact decimal maths end to end, with a single place to audit the arithmetic.

## Consequences

- The client never sends totals; the server calculates them (§9.6).
- The web shows a live preview only.
- Schema tests forbid `Float` and require every `Decimal` to be `@db.Decimal(12, 2)`.
