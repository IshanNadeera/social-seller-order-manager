# Architecture Decision Records

One file per decision (docs/DEVELOPMENT.md §21). ADR-001 to ADR-019 are the decisions settled in blueprint v1.1. ADR-020 onwards were made during the build, and approved by the product owner unless their status says otherwise.

| ADR                                        | Decision                                                                                           | Status                                      | Date       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- |
| [ADR-001](001-database-hosting.md)         | Database hosting: Supabase PostgreSQL                                                              | Accepted                                    | 2026-11-01 |
| [ADR-002](002-package-manager.md)          | Package manager: npm workspaces                                                                    | Accepted                                    | 2026-11-01 |
| [ADR-003](003-authentication.md)           | Authentication: Supabase Auth, API verifies JWTs via JWKS                                          | Accepted                                    | 2026-11-01 |
| [ADR-004](004-database-exposure.md)        | Database exposure: private app schema, revoked grants, RLS with no policies                        | Accepted                                    | 2026-11-01 |
| [ADR-005](005-order-statuses.md)           | Order statuses: seller workflow on orders, delivery status only on deliveries, derived stage label | Accepted                                    | 2026-11-01 |
| [ADR-006](006-payment-status.md)           | Payment status: stored, always recalculated from payment records                                   | Accepted                                    | 2026-11-01 |
| [ADR-007](007-cash-on-delivery.md)         | Cash on delivery: COD status lifecycle; payment recorded only at settlement                        | Accepted                                    | 2026-11-01 |
| [ADR-008](008-discounts.md)                | Discounts: one fixed amount per order                                                              | Accepted                                    | 2026-11-01 |
| [ADR-009](009-customer-on-orders.md)       | Customer required on every order, except anonymous walk-in pickups                                 | Accepted                                    | 2026-11-01 |
| [ADR-010](010-order-numbers.md)            | Order numbers: per-business prefix, {PREFIX}-{0001}, counter table                                 | Accepted                                    | 2026-11-01 |
| [ADR-011](011-money.md)                    | Money: NUMERIC(12,2), Prisma Decimal, decimal.js, strings in JSON                                  | Accepted                                    | 2026-11-01 |
| [ADR-012](012-deliveries.md)               | Deliveries: one row per delivery order; attempts counted, history in events                        | Accepted                                    | 2026-11-01 |
| [ADR-013](013-address-snapshots.md)        | Address snapshots: copied onto the delivery at creation                                            | Accepted                                    | 2026-11-01 |
| [ADR-014](014-refunds-overpayment.md)      | Refunds and overpayment: overpayment rejected, refunds limited, insert-only records                | Accepted                                    | 2026-11-01 |
| [ADR-015](015-dates-timezone.md)           | Dates and time zone: UTC storage, business time zone for display and filters                       | Accepted                                    | 2026-11-01 |
| [ADR-016](016-phone-numbers.md)            | Phone numbers: libphonenumber-js, default LK, E.164 plus display copy                              | Accepted                                    | 2026-11-01 |
| [ADR-017](017-idempotency.md)              | Idempotency keys on order, payment and COD settlement creation                                     | Accepted                                    | 2026-11-01 |
| [ADR-018](018-backups.md)                  | Backups: paid Supabase plan plus an independent nightly dump                                       | Accepted                                    | 2026-11-01 |
| [ADR-019](019-plan-limits.md)              | Plan limits: block new orders only, never access to existing data                                  | Accepted                                    | 2026-11-01 |
| [ADR-020](020-node-version.md)             | Node.js 26 as the pinned runtime                                                                   | Accepted                                    | 2026-11-01 |
| [ADR-021](021-test-runner.md)              | Test runner: Vitest (with SWC for the API) instead of Jest                                         | Accepted                                    | 2026-11-01 |
| [ADR-022](022-prisma-version-and-setup.md) | Prisma pinned to 7.x, with CommonJS client output and a config that works without a database       | Accepted                                    | 2026-11-01 |
| [ADR-023](023-schema-refinements.md)       | Schema and migration refinements beyond §8.4 and §8.5                                              | Accepted (A10, A23); A11 additions Proposed | 2026-11-01 |
| [ADR-024](024-request-validation.md)       | Request validation with shared Zod schemas instead of class-validator DTOs                         | Accepted                                    | 2026-11-01 |
| [ADR-025](025-environment-files.md)        | One .env.example per app, validated at startup                                                     | Accepted                                    | 2026-11-01 |
| [ADR-026](026-membership-resolution.md)    | Membership resolution: archived businesses ignored, oldest membership wins                         | Accepted                                    | 2026-11-01 |
| [ADR-027](027-email-links.md)              | Auth email links open /auth/confirm with a token hash                                              | Accepted                                    | 2026-11-01 |

## Adding or changing a decision

1. Copy the format of an existing file to `NNN-short-slug.md`, using the next free number. Numbers are never reused.
2. Fill in every section:
   - **Status:** `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNN`.
   - **Date:** YYYY-MM-DD.
   - **Blueprint:** the sections it rests on.
   - **Context**, **Options considered**, **Decision**, **Reason** and **Consequences**.
3. Never rewrite an accepted decision. Write a new ADR, and set the old one's status to `Superseded by ADR-NNN`.
4. Add it to the table above, and update `docs/DEVELOPMENT.md` (§21, and any section the decision changes) in the same pull request (§23 rule 10).

`npm run check:adr` (part of `npm test`) checks the numbering, the required sections, the status and date formats, and this index.
