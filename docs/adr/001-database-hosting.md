# ADR-001: Database hosting: Supabase PostgreSQL

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8, §10.2, §13.1, §11.6

## Context

The product needs a relational database for multi-tenant order, payment and delivery data with strict integrity (composite foreign keys, CHECK constraints, transactions). There is one developer, so operating a database server is not an option. Authentication is also needed (ADR-003), and a local development stack should match production closely.

## Options considered

- **Supabase PostgreSQL**: managed Postgres with backups, a local CLI stack (Docker) and Auth in the same platform.
- **Neon / other serverless Postgres**: good branching, but Auth would be a separate vendor.
- **AWS RDS or a self-managed VPS**: full control, but patching, backups and monitoring are on us.
- **Platform databases (Railway, Render)**: simple, but weaker backup and local-stack story.

## Decision

Use **Supabase** for PostgreSQL (and for Auth, ADR-003). One Supabase project per environment: local (CLI), staging and production. Only the NestJS API connects to the database; the browser uses Supabase for authentication only.

## Reason

Managed Postgres with daily backups, a local stack via `supabase start` that mirrors hosted behaviour, and authentication in the same platform keep operational work small for a single developer.

## Consequences

- The pilot and production need a **paid plan** (daily backups, no pausing). An independent nightly dump is still required (ADR-018).
- Supabase's auto-generated Data API must not expose tenant data. Tables live in a private `app` schema (ADR-004).
- Connections go through the Supavisor pooler, and the API pool stays small (`max: 5`).
- Hosting is outside Sri Lanka. This must be disclosed in the privacy policy (§11.5).
- The region (Singapore or Mumbai) is still open (§21, task F1).
