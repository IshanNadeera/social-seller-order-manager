# ADR-021: Test runner: Vitest (with SWC for the API) instead of Jest

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §10.1, §12

## Context

§10.1 allows "Jest (NestJS default) or Vitest". The web app uses Vite, so Vitest shares its config and transforms. NestJS dependency injection needs decorator metadata, which Vite's default esbuild transform does not emit.

## Options considered

- **Jest for the API, Vitest for the web**: two runners, two configs, two mocking APIs.
- **Jest everywhere**: the web app would need a separate transform pipeline from Vite.
- **Vitest everywhere, with `unplugin-swc` for the API** so decorator metadata is emitted.

## Decision

Use **Vitest** in all workspaces; the API compiles tests with SWC (`unplugin-swc`). Supertest is used for HTTP tests. Tests that need a database are `*.db-spec.ts`, run by `npm run test:db -w apps/api` with a separate config, so `npm test` never needs a database.

## Reason

One runner and one API across the repo, fast, and the same transforms as the web build.

## Consequences

- §10.1's "Jest (NestJS default)" wording should be updated to say Vitest.
- Database tests run one file at a time, because they share a database.
- CI runs them against a PostgreSQL service (ADR-004, task A22).
