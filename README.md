# Social Seller Order Manager

A multi-tenant web app that helps small online sellers in Sri Lanka keep track of orders they receive through Facebook, Instagram, TikTok, WhatsApp, phone calls, walk-ins and websites. Orders are entered manually; payments, deliveries and cash on delivery (COD) are tracked in one place.

> Never lose track of an order again.

**Status:** pre-alpha. The repository layout is in place; the apps are scaffolded in the next tasks.
The full specification is [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (blueprint v1.1). It is the source of truth: update it, and add an ADR, when an approved decision changes.

## Stack

- **Web:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Hook Form + Zod
- **API:** NestJS, TypeScript, Prisma 7, decimal.js, jose
- **Database and auth:** Supabase (PostgreSQL in a private `app` schema, Supabase Auth)
- **Tooling:** npm workspaces, TypeScript 6 (strict, shared `tsconfig.base.json`), ESLint (type-aware), Prettier, Jest/Vitest, Supertest, Playwright, GitHub Actions

## Repository layout

```text
apps/
  web/              React web app (auth via supabase-js only)
  api/              NestJS API; the only code that talks to the database
packages/
  shared/           Shared types, enums, stage labels, Zod schemas
supabase/           Supabase CLI config for the local stack
tests/
  e2e/              Playwright end-to-end tests
docs/
  DEVELOPMENT.md    The blueprint
  adr/              Architecture Decision Records
scripts/            Repository checks
```

## Common commands

Use the Node version in `.nvmrc` (Node 26, the Active LTS line). Installs refuse to run on other versions.
The dev, Prisma and Supabase commands work once those parts are set up (tasks A4–A9).

```bash
nvm use                             # switch to the Node version in .nvmrc
npm install                         # install all workspaces
npm ci                              # clean install from package-lock.json (CI)
npm run dev -w apps/api             # start API
npm run dev -w apps/web             # start web
npx -w apps/api prisma migrate dev  # create/apply local migration
npm test --workspaces               # run all unit tests
npx supabase start                  # start local Postgres, Auth and mail catcher (Docker)
npm run lint                        # ESLint across all workspaces
npm run format                      # format everything with Prettier
npm run format:check                # check formatting (CI)
npm run typecheck                   # tsc --noEmit in every workspace
npm test                            # repository checks + all workspace tests
npm run check                       # lint + format:check + typecheck + test (run before pushing)
bash scripts/check-structure.sh     # check the repository layout
```

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main` (§13.3). There are four jobs, run in parallel so one failure never hides another:

| Job           | What it runs                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`      | `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm test`                                                                                                                                                                   |
| `integration` | PostgreSQL 17 service → `scripts/ci/supabase-roles.sql` → `npm run db:deploy -w apps/api` (`prisma migrate deploy`) → **RLS gate** (`scripts/ci/check-rls.sql`) → **drift gate** (`npm run db:check-drift -w apps/api`) → `npm run test:db -w apps/api` |
| `build`       | `npm run build -w apps/web` and `npm run build -w apps/api`                                                                                                                                                                                             |
| `audit`       | `npm audit --audit-level=high`                                                                                                                                                                                                                          |

- The integration job uses a throwaway database with fake local values only. No repository secrets are used.
- A plain PostgreSQL lacks Supabase's `anon`, `authenticated` and `service_role` roles, so `supabase-roles.sql` creates them first. The migration then really has to lock them out of `app`, and `migration.db-spec.ts` checks it.
- Actions are pinned to full commit SHAs, and permissions are read-only.
- **RLS gate (A23, ADR-004):** fails, naming the tables, if any table in `app` has row-level security off. It also fails if `anon`, `authenticated` or `service_role` have any privilege on the `app` schema or its tables.
- **Drift gate (A23):** compares the database the migrations just built with `schema.prisma` (`prisma migrate diff --from-config-datasource --to-schema … --exit-code`). If the schema changed without a migration, it fails and prints the missing SQL and the command to create the migration.
- `npm run check:ci` (part of `npm test`) fails if any of these happens:
  - a required step is removed;
  - an action is unpinned;
  - the order roles → migrate → RLS → drift → tests changes;
  - secrets appear.
- To run the integration steps locally against the Supabase stack: `npm run db:deploy -w apps/api && npm run db:check-drift -w apps/api && npm run test:db -w apps/api`. The RLS rules are also covered by `test/migration.db-spec.ts`.

## Ground rules

- Never commit `.env` files, Supabase keys or real customer data. Only `.env.example` is tracked.
- The browser never queries `app` tables; all data goes through the API.
- The API never trusts `businessId`, totals, statuses or permissions sent by the client.
- One logical change per commit. See `docs/DEVELOPMENT.md` §23 for the full working rules.
