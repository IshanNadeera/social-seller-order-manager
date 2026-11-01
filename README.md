# Social Seller Order Manager

A multi-tenant web app that helps small online sellers in Sri Lanka keep track of orders they receive through Facebook, Instagram, TikTok, WhatsApp, phone calls, walk-ins and websites. Orders are entered manually; payments, deliveries and cash on delivery (COD) are tracked in one place.

> Never lose track of an order again.

**Status:** pre-alpha. The repository layout is in place; the apps are scaffolded in the next tasks.
The full specification is [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (blueprint v1.1). It is the source of truth: update it, and add an ADR, when an approved decision changes.

## Stack

- **Web:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Hook Form + Zod
- **API:** NestJS, TypeScript, Prisma 7, decimal.js, jose
- **Database and auth:** Supabase (PostgreSQL in a private `app` schema, Supabase Auth)
- **Tooling:** npm workspaces, ESLint, Prettier, Jest/Vitest, Supertest, Playwright, GitHub Actions

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

These work once the workspaces are set up (tasks A2–A9).

```bash
npm install                         # install all workspaces
npm run dev -w apps/api             # start API
npm run dev -w apps/web             # start web
npx -w apps/api prisma migrate dev  # create/apply local migration
npm test --workspaces               # run all unit tests
npx supabase start                  # start local Postgres, Auth and mail catcher (Docker)
bash scripts/check-structure.sh     # check the repository layout
```

## Ground rules

- Never commit `.env` files, Supabase keys or real customer data. Only `.env.example` is tracked.
- The browser never queries `app` tables; all data goes through the API.
- The API never trusts `businessId`, totals, statuses or permissions sent by the client.
- One logical change per commit. See `docs/DEVELOPMENT.md` §23 for the full working rules.
