# ADR-004: Database exposure: private app schema, revoked grants, RLS with no policies

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8.1, §8.5, §11.1, §11.3, §13.3

## Context

Supabase automatically exposes tables through its REST and GraphQL Data API to the `anon` and `authenticated` roles. Our design has the API, not the browser, enforce tenant isolation and business rules. Tenant data reachable through the Data API would bypass all of that.

## Options considered

- **Tables in `public` with RLS policies, browser queries directly**: the Supabase-native model. Every rule would have to be written as an RLS policy, and server-side money logic would be bypassed.
- **Tables in `public`, API-only access, rely on grants**: one misconfigured grant exposes everything.
- **Private `app` schema, not exposed; grants revoked; RLS enabled with no policies; API-only access**: several independent layers.
- **Disable the Data API entirely**: also possible, and can be added on top.

## Decision

All application tables live in a private **`app`** schema that is **not** in Supabase's exposed schemas.

- All privileges on `app` are revoked from `anon`, `authenticated` and `service_role`.
- **RLS is enabled on every table with no policies**, as a second layer.
- Only the API connects, as the table owner, which bypasses RLS by design.

## Reason

Defence in depth: the Data API cannot see the schema, the roles have no grants, and even if both failed, RLS returns nothing. Tenant rules stay in one place, the API (§11.1).

## Consequences

- Every migration that adds a table must also `ENABLE ROW LEVEL SECURITY` on it (§8.5).
- CI fails if any `app` table has RLS disabled, or if the API roles gain any privilege on `app`: `scripts/ci/check-rls.sql` (task A23). `test/migration.db-spec.ts` checks the same rules against the local database.
- The browser can never use `supabase-js` for data. ESLint allows importing it only in `src/lib/supabase.ts`, which exports the auth client alone.
- Run Supabase's Security Advisor before each release (task F11).
