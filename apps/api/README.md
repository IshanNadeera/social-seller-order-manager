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

### Checks that guard migrations (A23)

- **Every schema change needs a migration.** `npm run db:check-drift -w apps/api` (`scripts/check-drift.ts`) compares the database the migrations built (`DIRECT_URL`) with `schema.prisma`. If they differ, it prints the SQL a migration is missing and exits non-zero.
  - CI runs it right after `prisma migrate deploy`. Locally, run it after `npm run db:migrate`.
  - Hand-written SQL (CHECKs, partial indexes, RLS, grants) is invisible to Prisma, so it never counts as drift.
- **Every `app` table has RLS, and the API roles have no access.** `scripts/ci/check-rls.sql` (repo root) is the CI gate. A migration that adds a table must also contain `ALTER TABLE app.<table> ENABLE ROW LEVEL SECURITY;` (§8.5).
- Give migrations a clear name: `npm run db:migrate -w apps/api -- --name add_customer_notes`.

### Demo data

`npm run db:seed -w apps/api` creates or refreshes a fake demo business ("Demo Boutique", prefix `DEMO`) with an owner, customers, addresses and products (`prisma/demo-data.ts`). It is safe to run repeatedly and never resets the order counter. Everything in it is fictional: surnames are "Demo", emails use `example.test`, phones are `077 000 00xx` placeholders. Never add real customer data (§13.2).

The seed refuses to run when `NODE_ENV=production`, and against any non-local database unless `SEED_ALLOW_REMOTE=true` is set for that one command (staging with fake data only). The demo owner exists only in `app.users`, not in Supabase Auth, so you cannot log in as them; real accounts come from sign-up and onboarding (A16, A19).

## Authentication

- Supabase Auth issues access tokens in the browser; the API only verifies them (§11.2, ADR-003). It never handles passwords and holds no shared JWT secret.
- `src/auth/auth.guard.ts` is a **global** guard: every route requires `Authorization: Bearer <token>` unless the route or controller is marked `@Public()` (today only `GET /health`). New routes are protected by default.
- `src/auth/jwt-verifier.ts` checks the signature against Supabase's public keys (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, ES256/RS256 only), `iss` = `SUPABASE_JWT_ISSUER`, `aud` = `authenticated`, expiry and not-before (5 s clock tolerance), and that `sub` is a user ID. Anonymous users are refused.
- The keys are cached in memory for 10 minutes and refetched only when a token names a new key ID (key rotation), at most every 30 seconds (`src/auth/jwks.ts`).
- A bad token gets 401. If Supabase's keys cannot be fetched, the API answers 503 instead, so an outage does not look like a logout. Tokens and `Authorization` headers are never logged.
- After the token, the guard loads the account (one query, `src/auth/account.service.ts`):
  - `users.disabled_at` set → **403 `ACCOUNT_DISABLED`** on every route.
  - A membership in a non-archived business → `req.auth = { userId, businessId, role }`. If there are several (STAFF, later), the oldest is used.
  - No membership (or no `users` row yet) → **403 `ONBOARDING_REQUIRED`**, except on routes marked `@AllowWithoutMembership()`: only `GET /me` and `POST /onboarding` (§11.2).
- `GET /me` (`src/auth/me.controller.ts`) is membership-optional: it returns the user, `needsOnboarding`, the role and a business summary (`MeResponse` in `@ssom/shared`), and syncs an email changed in Supabase Auth into `app.users` (§8.2).
- `GET /health` is public: it pings the database (2 s cap) and answers `200 {"status":"ok","database":"ok"}` or `503 {"status":"error","database":"unreachable"}`, never anything else (§11.7). The database pool gives up on a connection after 5 s instead of waiting forever.
- In controllers, read the scope with `@CurrentAuth() auth: AuthContext` and the token user with `@CurrentUser() user: VerifiedUser`. **`auth.businessId` is the only source of tenant scope**: never take a business ID from the body, query or path (§11.1).

## Tenant isolation (§11.1, §12.4)

Every tenant-owned query is scoped to the business of the verified membership. Rules for every endpoint:

- Controllers get the scope with `@CurrentAuth() auth: AuthContext` and pass `auth` as the **first argument** of each service method. A business ID never comes from the body, query, path or headers; ESLint rejects `req.body.businessId`, `@Body('businessId')` and similar, and strict request schemas reject a `businessId` field.
- Queries use `tenantWhere(auth, { id, ... })`; creates use `tenantData(auth, data)` (`src/common/tenant.ts`). Both apply `businessId` last, so it always wins. Prefer `findFirst` / `updateMany` / `deleteMany` with `tenantWhere` over `findUnique({ where: { id } })`, which cannot be scoped.
- "Not found" and "another business's record" must look identical: use `orNotFound(row)` / `assertTouched(result)`, and `@Param('id', IdParamPipe)` for IDs (a non-UUID also gets the same 404).
- The database backs this up with composite foreign keys `(business_id, …)` (§8.1).
- Every endpoint gets cross-tenant tests with `test/tenant-isolation.ts`: `createTwoTenants()` and `expectCrossTenant404()` (same 404 body as a random ID). `test/test-auth.ts` signs test tokens.

## Validation, errors and logging (§9.7, §9.8, §11.7)

- **Validation:** request bodies and query strings are checked against the shared Zod schemas in `@ssom/shared` (owner decision in A16, instead of class-validator DTOs). Schemas are strict, so unknown fields are **refused** with a field error, not dropped. This is the blueprint's `whitelist` + `forbidNonWhitelisted` rule:
  - `@Body(new ZodBodyPipe(schema))` for bodies;
  - `@Query(new ZodQueryPipe(schema))` for the whole query string. Query values are strings, so use `z.coerce` in the schema.
- **One error shape.** Every error is `{ code, message, fieldErrors, requestId }` (`ApiErrorBody` in `@ssom/shared`). `HttpErrorFilter` (`src/common/http-error.filter.ts`) applies it globally, and `bodyParserErrorHandler` applies it to errors raised before routing: **413 `PAYLOAD_TOO_LARGE`** and **400 `INVALID_JSON`**.
  - Throw `new XxxException({ code, message })` for your own codes. Bare framework exceptions get a default code per status (`src/common/errors.ts`).
  - Anything that is not an `HttpException` becomes **500 `INTERNAL_ERROR`** with a generic message. Details and stack go to the log only.
  - `GET /health` is the one exception: it keeps its own `{ status, database }` body.
- **Request ID:** every response carries `X-Request-Id` (exposed to the browser through CORS), and the same ID is in the error body and the log line. A client may send its own (8–64 letters, digits or dashes); anything else is replaced with a new UUID.
- **Logs:** pino writes JSON to stdout, at `LOG_LEVEL`. There is one line per request with `req.id`, method, path **without the query string**, status, `responseTime`, `userId` and `businessId`. 4xx requests log as `warn`, 5xx as `error`.
  - Headers, bodies and query strings are never logged.
  - Keys named `authorization`, `cookie`, `token`, `password`, `email` or `phone` are redacted wherever they appear.
  - Never put names, phones, emails or addresses in a log message. Log IDs instead.
- **Rate limit:** 300 requests per minute per signed-in user (`UserThrottlerGuard`, after `AuthGuard`). Public routes are limited per IP address. Over the limit: **429 `RATE_LIMITED`** with `Retry-After`. Limits are in memory, per API instance. When the API runs behind a proxy, set Express `trust proxy` at deploy time (F7) so IP limits see the real client.
- Tests: `test/errors.spec.ts` and `test/throttle.spec.ts`. `test/http-app.ts` starts the real app with test keys and captures log lines.

## Customers API (§9.2, task B2)

`src/customers/`. All routes need a signed-in member, are scoped to their business, and answer `Cache-Control: no-store` (the responses hold personal data).

| Route                                                | What it does                                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /customers?q=&page=&pageSize=&includeArchived=` | Search, 25 per page by default, at most 100. Sorted by name, then ID, so pages never overlap. Returns `Page<CustomerSummary>` (`items`, `page`, `pageSize`, `total`).                           |
| `POST /customers`                                    | Create, optionally with a first `address` that becomes the default. One transaction: an invalid address creates nothing. 201 + `CustomerDetail`.                                                |
| `GET /customers/:id`                                 | `CustomerDetail`: the customer, active addresses (default first), `orderCount` and `lastOrderAt`.                                                                                               |
| `PATCH /customers/:id`                               | Change only the fields sent; `null` or `""` clears phone, email or notes. An empty body is 400 "Change at least one field." An archived customer is **422 `CUSTOMER_ARCHIVED`**.                |
| `POST /customers/:id/archive`                        | Archive (customers are never deleted, §8.1). Repeating it is harmless and keeps the first date. Archived customers stay readable and leave the default list; `includeArchived=true` shows them. |

- **Search (`src/customers/customer-search.ts`):** `q` matches any part of the name (case-insensitive, served by the trigram index), any part of the phone as typed, or, when `q` has 9 or more digits, the last 9 digits of the normalised phone. So `0771234567`, `+94 77 123 4567`, `771234567` and `0094771234567` all find the same customer.
- **Prisma does not escape `%` and `_`** in `contains` / `startsWith` / `endsWith`. Pass user text through `escapeLike()` first, as the customer search does, or a search for `_` matches everything.
- **Phones** go through `normalizePhone()` from `@ssom/shared` on create and update. A number that cannot be read is saved anyway, with `phoneE164: null` and `phoneWarning: 'PHONE_UNREADABLE'` in responses (§7.11).
- Request schemas live in `@ssom/shared` (`customerCreateSchema`, `customerUpdateSchema`, `customerListQuerySchema`, `addressCreateSchema`, `addressUpdateSchema`), so the web forms (B6) use the same rules and messages.
- Tests: `test/customer-search.spec.ts` (the filter, no database) and `test/customers.db-spec.ts` (every route against the database, with basic cross-tenant 404s; the full sweep is B5).

### Customer addresses (§7.11, §9.2, task B3)

`src/customers/addresses.*`. Each route answers with the whole `CustomerDetail`, because a change can move the default to another address.

| Route                                              | What it does                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /customers/:id/addresses`                    | Add an address (201). `isDefault: true` makes it the default.                                                 |
| `PATCH /customers/:id/addresses/:addressId`        | Change only the fields sent; `null` or `""` clears an optional field. `isDefault: true` makes it the default. |
| `POST /customers/:id/addresses/:addressId/archive` | Archive (never deleted). Repeating it is harmless.                                                            |

- **One default, always.** A customer with active addresses has exactly one default:
  - the first address becomes the default even if not asked;
  - making another the default moves it in the same transaction;
  - archiving the default passes it to the oldest remaining address;
  - `isDefault: false` is refused ("make another address the default"). The partial unique index `address_one_default` is the final guard.
- **Locking.** Every address change runs in one transaction that first locks the customer row (`lockActiveCustomer()` in `customer-lock.ts`, `SELECT … FOR UPDATE`), so two changes to one customer never interleave.
- **Required:** `recipientName`, `phone` and `addressLine1` (all NOT NULL in §8.2). Label, line 2, city, district and postal code are optional.
- **Errors:**
  - Any change for an archived customer: **422 `CUSTOMER_ARCHIVED`**.
  - Editing an archived address: **422 `ADDRESS_ARCHIVED`**.
  - More than `MAX_ACTIVE_ADDRESSES` (20) active addresses: **422 `ADDRESS_LIMIT_REACHED`**. The customer page lists every active address, so the list stays bounded.
  - An address of another customer or business: the standard 404.
- Orders keep their own copy of the address (§7.11), so these changes never alter existing orders.
- Tests: `test/addresses.db-spec.ts`, including two concurrent "make default" requests.

## Environment

- `src/common/env.ts` validates the environment with Zod before Nest starts (§10.4). If anything is missing or invalid, the API lists every problem by variable name (never by value) and exits. `apps/api/.env.example` documents each variable.
- Read settings by injecting them, never from `process.env`: `constructor(@Inject(ENV) private readonly env: Env)` (`ENV` from `src/common/env.module.ts`). Tests build the app with `AppModule.forRoot(testEnv)` from `test/test-env.ts`.
- `src/load-env.ts` loads `apps/api/.env` locally; variables already set in the environment win, so hosted environments use their own secret settings.
- Production additionally requires `https` for `SUPABASE_URL`, `SUPABASE_JWT_ISSUER` and `WEB_ORIGIN`.
- The API refuses to start if a Supabase service-role or secret key is present. It does not need one, and it must never hold one.
- To add a variable: add it to the schema in `env.ts`, to `.env.example`, to `test/test-env.ts` if required, and to the host's secret settings for staging and production.
