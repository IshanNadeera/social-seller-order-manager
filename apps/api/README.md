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
```

## How it is put together

- `src/main.ts` starts the server. `src/app.setup.ts` holds the HTTP setup shared with the tests: the `/api/v1` prefix, `helmet`, a 100 KB JSON body limit, and CORS that allows only the exact `WEB_ORIGIN` (§11.4).
- The API compiles to CommonJS with decorator metadata, which Nest's dependency injection needs. Because of that, a class injected through a constructor must be imported as a value (`import { X }`), never as `import type`; ESLint is configured to respect this.
- Tests use Vitest with SWC (`vitest.config.mts`) so decorator metadata is emitted in tests too. Unit tests sit next to the code as `*.spec.ts`; HTTP-level tests live in `test/`.
- One folder per module from §10.3 (`auth`, `onboarding`, `businesses`, `customers`, `products`, `orders`, `payments`, `deliveries`, `dashboard`, `reports`, `exports`, `idempotency`, `common`). Empty folders are filled by later tasks.
- Prisma schema and migrations land in `prisma/` (tasks A9–A11).

## Environment

- `src/common/env.ts` validates the environment with Zod before Nest starts (§10.4). If anything is missing or invalid, the API lists every problem by variable name (never by value) and exits. `apps/api/.env.example` documents each variable.
- Read settings by injecting them, never from `process.env`: `constructor(@Inject(ENV) private readonly env: Env)` (`ENV` from `src/common/env.module.ts`). Tests build the app with `AppModule.forRoot(testEnv)` from `test/test-env.ts`.
- `src/load-env.ts` loads `apps/api/.env` locally; variables already set in the environment win, so hosted environments use their own secret settings.
- Production additionally requires `https` for `SUPABASE_URL`, `SUPABASE_JWT_ISSUER` and `WEB_ORIGIN`.
- The API refuses to start if a Supabase service-role or secret key is present. It does not need one, and it must never hold one.
- To add a variable: add it to the schema in `env.ts`, to `.env.example`, to `test/test-env.ts` if required, and to the host's secret settings for staging and production.
