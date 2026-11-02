# ADR-020: Node.js 26 as the pinned runtime

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §10.1 ("pin the major version in .nvmrc and engines"), ADR-002

## Context

§10.1 asks for the Node LTS major to be pinned in `.nvmrc` and `engines`. During task A4, installing the NestJS CLI failed with EBADENGINE: `@angular-devkit/core` needs Node ^24.15, and the machine had 24.10. Node 26 became Active LTS in late October 2026, and Node 24 moved to maintenance.

## Options considered

- **Stay on Node 24, update to ≥ 24.15**: works, but starts the project on a line already in maintenance.
- **Node 26 (Active LTS)**: the longest support window for a project starting now.

## Decision

Pin **Node 26**: `.nvmrc` = 26, `engines.node` = `>=26.0.0 <27`, `engine-strict=true`, `@types/node` 26.x. CI reads the version from `.nvmrc`. Owner decision, task A2/A4.

## Reason

The longest support window, and the dependency set installs cleanly.

## Consequences

- Installs fail on any other major.
- The API relies on Node 26 features: `require(esm)` loads the ESM shared package from CommonJS, and `process.loadEnvFile` reads `.env`.
- The hosting platforms chosen in F1 must offer Node 26.
