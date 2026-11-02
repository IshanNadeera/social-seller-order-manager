# ADR-022: Prisma pinned to 7.x, with CommonJS client output and a config that works without a database

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8.4, §10.4, ADR-001

## Context

§8.4 targets Prisma 7. During task A9, `npm install prisma` (latest) resolved to **8.0.0-rc**, whose CLI no longer has `generate`. The API runs as CommonJS, and Prisma 7's new `prisma-client` generator emits ESM by default. CI must be able to run `prisma generate` and `validate` without a database.

## Options considered

- **Follow `latest` (Prisma 8 RC)**: a pre-release with a changed CLI.
- **Pin Prisma 7 exactly**, and adapt the setup to CommonJS and CI.

## Decision

Pin `prisma` and `@prisma/client` to **7.x exactly** (7.10.1 at the time).

- The generator is `prisma-client` with `moduleFormat = "cjs"`, output to `src/generated/prisma` (git-ignored, regenerated on install).
- `prisma.config.ts` loads `apps/api/.env` itself and reads `DIRECT_URL` from `process.env`, not `env()`, so `generate` works without one.
- The runtime uses `@prisma/adapter-pg` with `max: 5` and a 5 s connection timeout.

## Reason

A stable major, matching the blueprint, that works with the CommonJS API and in CI.

## Consequences

- Moving to Prisma 8 is a separate, deliberate decision once 8.0 is stable.
- Prisma 7 removed `--shadow-database-url`. The drift check compares the migrated database with the schema using `--from-config-datasource` (task A23).
- The §8.4 snippets (`import 'dotenv/config'`, `env('DIRECT_URL')`, `process.env.DATABASE_URL` in `PrismaService`) differ from the implementation and should be updated.
