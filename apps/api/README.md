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
```

Database tests (`test/**/*.db-spec.ts`) run only with `npm run test:db -w apps/api`, never in the default `npm test`, so unit tests never need a database.

## Environment

- `src/common/env.ts` validates the environment with Zod before Nest starts (§10.4). If anything is missing or invalid, the API lists every problem by variable name (never by value) and exits. `apps/api/.env.example` documents each variable.
- Read settings by injecting them, never from `process.env`: `constructor(@Inject(ENV) private readonly env: Env)` (`ENV` from `src/common/env.module.ts`). Tests build the app with `AppModule.forRoot(testEnv)` from `test/test-env.ts`.
- `src/load-env.ts` loads `apps/api/.env` locally; variables already set in the environment win, so hosted environments use their own secret settings.
- Production additionally requires `https` for `SUPABASE_URL`, `SUPABASE_JWT_ISSUER` and `WEB_ORIGIN`.
- The API refuses to start if a Supabase service-role or secret key is present. It does not need one, and it must never hold one.
- To add a variable: add it to the schema in `env.ts`, to `.env.example`, to `test/test-env.ts` if required, and to the host's secret settings for staging and production.
