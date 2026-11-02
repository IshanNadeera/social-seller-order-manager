# ADR-002: Package manager: npm workspaces

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §10.1, §10.3

## Context

The repository holds the web app, the API and a shared package. They must share types and enums, install reproducibly and run in CI with one command.

## Options considered

- **npm workspaces**: built into Node; no extra tool.
- **pnpm workspaces**: faster and stricter, but one more tool to install and learn.
- **Yarn (Berry)**: Plug'n'Play compatibility issues with some tooling.
- **Turborepo / Nx on top**: caching and task graphs; too much for three packages.

## Decision

Use **npm workspaces** (`apps/*`, `packages/*`). Commit `package-lock.json`; CI installs with `npm ci`. Pin exact versions of Prisma, NestJS and supabase-js.

## Reason

It is the team's preference and needs no additional tooling. Three packages do not need a build orchestrator.

## Consequences

- The shared package is compiled to `dist/` (rebuilt on `postinstall` and before lint, typecheck, dev and build) and consumed by both apps.
- `engine-strict=true` makes installs fail on the wrong Node version (ADR-020).
- Dependency upgrades are deliberate, one at a time, because versions are pinned exactly.
