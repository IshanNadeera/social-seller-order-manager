# ADR-023: Schema and migration refinements beyond §8.4 and §8.5

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8.1, §8.4, §8.5, ADR-004, ADR-009

## Context

Implementing §8.4 and §8.5 exposed places where the blueprint's schema did not fully apply its own rules (§8.1: composite tenant keys on every child table), and constraints that §7 states but §8.5 did not enforce. Prisma's diffing also clashed with the hand-written trigram index.

## Options considered

- **Implement §8.4 and §8.5 exactly as written**: leaves gaps in tenant isolation and rules enforced only in code.
- **Close the gaps in the schema and migration, and record them here.**

## Decision

**A10 (owner-approved 1 Nov 2026):**

1. `@@unique([businessId, id])` on `order_items`, `deliveries` and `order_events`, as §8.1 requires for every tenant table.
2. `deliveries.cod_payment_id` has a tenant-scoped foreign key to `payments`, 1:1 via `@@unique([businessId, codPaymentId])`.
3. Enums are mapped to snake_case PostgreSQL type names, as in §8.2.

**A11 extra SQL (owner-approved 2 Nov 2026):**

- `pg_trgm` is created in the `extensions` schema, which is Supabase's convention.
- The REVOKE also covers `service_role` and default privileges, and runs only for roles that exist, so the migration works on plain PostgreSQL.
- Extra CHECK constraints:
  - total and line-total arithmetic;
  - walk-in orders → pickup (§7.10);
  - COD → delivery only (§7.8);
  - `source_note` ≤ 100 characters (§7.9);
  - users' emails lower-case;
  - order counter ≥ 1;
  - default delivery fee ≥ 0;
  - delivery attempts ≥ 0.

**Trigram index (A11, corrected in A23):** declared in `schema.prisma` as `@@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "customers_name_trgm")`, so `migrate dev` does not drop it. The operator class is written without its schema, because Prisma reads it from the database by its bare name (`pg_opclass.opcname`) and compares the text exactly.

## Reason

Every tenant-owned row is protected by composite keys, and rules from §7 are enforced by the database as well as the API. Both are listed as mandatory in §8.3.

## Consequences

- `test/prisma-schema.spec.ts` and `test/migration.db-spec.ts` check these rules: 35 constraint cases, RLS, grants and indexes.
- Migration `20261101132259_sample` only recreates the trigram index. It is kept because it has already been applied. Future migrations get descriptive names.
- The blueprint amendment of 2 Nov 2026 updates §8.4 and §8.5 to match.
