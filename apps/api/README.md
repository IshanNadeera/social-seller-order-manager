# apps/api

NestJS + TypeScript API with Prisma 7. This is the only part of the system that talks to the database (schema `app` on Supabase Postgres).
Verifies Supabase access tokens via JWKS; takes the business scope from the verified membership, never from the client.

See `docs/DEVELOPMENT.md` §8, §9, §10 and §11.

## Running locally

```bash
cp apps/api/.env.example apps/api/.env   # once; edit if your web app runs elsewhere
npm run dev -w apps/api                  # http://localhost:3000/api/v1/health
npm test -w apps/api                     # unit + HTTP tests (Vitest)
npm run build -w apps/api                # compile to apps/api/dist
```

## How it is put together

- `src/main.ts` starts the server. `src/app.setup.ts` holds the HTTP setup shared with the tests: the `/api/v1` prefix, `helmet`, a 100 KB JSON body limit, and CORS that allows only the exact `WEB_ORIGIN` (§11.4).
- The API compiles to CommonJS with decorator metadata, which Nest's dependency injection needs. Because of that, a class injected through a constructor must be imported as a value (`import { X }`), never as `import type`; ESLint is configured to respect this.
- Tests use Vitest with SWC (`vitest.config.mts`) so decorator metadata is emitted in tests too. Unit tests sit next to the code as `*.spec.ts`; HTTP-level tests live in `test/`.
- One folder per module from §10.3 (`auth`, `onboarding`, `businesses`, `customers`, `products`, `orders`, `payments`, `deliveries`, `dashboard`, `reports`, `exports`, `idempotency`, `common`). Empty folders are filled by later tasks.
- Prisma schema and migrations land in `prisma/` (tasks A9–A11). Environment validation with Zod arrives in A7; until then `src/common/bootstrap-config.ts` checks `PORT` and `WEB_ORIGIN`.
