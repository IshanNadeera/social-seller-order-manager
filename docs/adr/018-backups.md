# ADR-018: Backups: paid Supabase plan plus an independent nightly dump

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §11.6

## Context

Losing sellers' orders would end the product. Provider backups alone are a single point of failure, and a backup that has never been restored is not proven.

## Options considered

- **Supabase free tier**: no backups, and projects pause.
- **Paid Supabase daily backups only**: depends on one provider.
- **Paid daily backups, plus a nightly encrypted `pg_dump` of `app` stored outside Supabase, plus restore tests.**

## Decision

Pilot and production run on a paid Supabase plan with daily backups. A nightly GitHub Action dumps schema `app`, encrypts it and keeps it outside Supabase for 30 days. RPO is 24 hours and RTO 4 hours for the pilot; Point-in-Time Recovery is evaluated before paid launch. Restores are tested before the pilot and every quarter.

## Reason

Restorable even if the provider has an issue, at pilot-appropriate cost.

## Consequences

- `docs/RESTORE.md` and the dump job are tasks F9 and F10.
- Migrations are forward-only; destructive changes go expand → migrate data → contract.
