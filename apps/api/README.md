# apps/api

NestJS + TypeScript API with Prisma 7. This is the only part of the system that talks to the database (schema `app` on Supabase Postgres).
Verifies Supabase access tokens via JWKS; takes the business scope from the verified membership, never from the client.

See `docs/DEVELOPMENT.md` §8, §9, §10 and §11.

## Running locally

```bash
cp apps/api/.env.example apps/api/.env   # once; the defaults match the local Supabase stack
npm run dev -w apps/api                  # http://localhost:3000/api/v1/health
npm test -w apps/api                     # unit + HTTP tests (Vitest)
npm run build -w apps/api                # compile to apps/api/dist
npm run test:db -w apps/api              # database tests; needs `npm run db:start` first
```

## How it is put together

- `src/main.ts` starts the server. `src/app.setup.ts` holds the HTTP setup shared with the tests: the `/api/v1` prefix, `helmet`, a 100 KB JSON body limit, and CORS that allows only the exact `WEB_ORIGIN` (§11.4).
- The API compiles to CommonJS with decorator metadata, which Nest's dependency injection needs. Because of that, a class injected through a constructor must be imported as a value (`import { X }`), never as `import type`; ESLint is configured to respect this.
- Tests use Vitest with SWC (`vitest.config.mts`) so decorator metadata is emitted in tests too. Unit tests sit next to the code as `*.spec.ts`; HTTP-level tests live in `test/`.
- One folder per module from §10.3 (`auth`, `onboarding`, `businesses`, `customers`, `products`, `orders`, `payments`, `deliveries`, `dashboard`, `reports`, `exports`, `idempotency`, `common`). Empty folders are filled by later tasks.

## Database (Prisma 7)

- `prisma/schema.prisma` holds the models. Every model and enum lives in the private `app` schema and must declare `@@schema("app")`; `test/prisma-schema.spec.ts` fails otherwise. No connection URLs go in the schema.
- `prisma.config.ts` configures the Prisma CLI. It loads `apps/api/.env` and connects with `DIRECT_URL` (a session-level connection; never the transaction pooler). Run Prisma through the npm scripts below so it runs from `apps/api`.
- The running API connects through `PrismaService` (`src/common/prisma.service.ts`) with the `@prisma/adapter-pg` driver adapter, `DATABASE_URL` and a pool of at most 5 connections. Inject `PrismaService`; never create another `PrismaClient`. Every tenant query must still be scoped by `businessId` (§11.1).
- The client is generated into `src/generated/prisma` (git-ignored) as CommonJS. `prisma generate` runs after every `npm install`; run it again after editing the schema if you are not migrating.

```bash
npm run prisma:generate -w apps/api   # rebuild the client after a schema change
npm run prisma:validate -w apps/api   # check the schema
npm run db:migrate -w apps/api        # create and apply a migration locally (prisma migrate dev)
npm run db:deploy -w apps/api         # apply existing migrations (CI, staging, production)
npm run db:seed -w apps/api           # add or refresh the fake demo business (local only)
```

Database tests (`test/**/*.db-spec.ts`) run only with `npm run test:db -w apps/api`, never in the default `npm test`, so unit tests never need a database.

### Migrations

Migrations are forward-only and reviewed by hand (§8.3, §11.6). Prisma cannot express CHECK constraints, partial indexes, grants or RLS, so those are hand-written SQL appended to the migration Prisma generates (§8.5, ADR-004). `test/migration.db-spec.ts` checks all of them against the database.

1. Change `prisma/schema.prisma`.
2. `npm run db:migrate -w apps/api -- --create-only --name <what_changed>` generates the SQL without applying it.
3. Review `prisma/migrations/<timestamp>_<name>/migration.sql`. If it adds a table, append the RLS block from the initial migration so the new table has row-level security too. If it drops a hand-written index or constraint, remove that line. Prisma drops any non-partial index it does not find in the schema, so declare such indexes in `schema.prisma` (as `customers_name_trgm` is).
4. `npm run db:migrate -w apps/api` applies it, then `npm run test:db -w apps/api`.

Never edit a migration that has been applied anywhere else; add a new one.

### Demo data

`npm run db:seed -w apps/api` creates or refreshes a fake demo business ("Demo Boutique", prefix `DEMO`) with an owner, customers, addresses and products (`prisma/demo-data.ts`). It is safe to run repeatedly and never resets the order counter. Everything in it is fictional: surnames are "Demo", emails use `example.test`, phones are `077 000 00xx` placeholders. Never add real customer data (§13.2).

The seed refuses to run when `NODE_ENV=production`, and against any non-local database unless `SEED_ALLOW_REMOTE=true` is set for that one command (staging with fake data only). The demo owner exists only in `app.users`, not in Supabase Auth, so you cannot log in as them; real accounts come from sign-up and onboarding (A16, A19).

## Authentication

- Supabase Auth issues access tokens in the browser; the API only verifies them (§11.2, ADR-003). It never handles passwords and holds no shared JWT secret.
- `src/auth/auth.guard.ts` is a **global** guard: every route requires `Authorization: Bearer <token>` unless the route or controller is marked `@Public()` (today only `GET /health`). New routes are protected by default.
- `src/auth/jwt-verifier.ts` checks the signature against Supabase's public keys (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, ES256/RS256 only), `iss` = `SUPABASE_JWT_ISSUER`, `aud` = `authenticated`, expiry and not-before (5 s clock tolerance), and that `sub` is a user ID. Anonymous users are refused.
- The keys are cached in memory for 10 minutes and refetched only when a token names a new key ID (key rotation), at most every 30 seconds (`src/auth/jwks.ts`).
- A bad token gets 401. If Supabase's keys cannot be fetched, the API answers 503 instead, so an outage does not look like a logout. Tokens and `Authorization` headers are never logged.
- The verified user is on `req.user` (`AuthenticatedRequest`). Business membership is added in task A14.

## Environment

- `src/common/env.ts` validates the environment with Zod before Nest starts (§10.4). If anything is missing or invalid, the API lists every problem by variable name (never by value) and exits. `apps/api/.env.example` documents each variable.
- Read settings by injecting them, never from `process.env`: `constructor(@Inject(ENV) private readonly env: Env)` (`ENV` from `src/common/env.module.ts`). Tests build the app with `AppModule.forRoot(testEnv)` from `test/test-env.ts`.
- `src/load-env.ts` loads `apps/api/.env` locally; variables already set in the environment win, so hosted environments use their own secret settings.
- Production additionally requires `https` for `SUPABASE_URL`, `SUPABASE_JWT_ISSUER` and `WEB_ORIGIN`.
- The API refuses to start if a Supabase service-role or secret key is present. It does not need one, and it must never hold one.
- To add a variable: add it to the schema in `env.ts`, to `.env.example`, to `test/test-env.ts` if required, and to the host's secret settings for staging and production.
