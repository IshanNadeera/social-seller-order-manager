# apps/web

Responsive web app: React + TypeScript + Vite, Tailwind CSS, React Router, React Hook Form + Zod, TanStack Query.
Uses `@supabase/supabase-js` for authentication only. It never queries application tables directly.

See `docs/DEVELOPMENT.md` §6 and §10.

## Running locally

```bash
cp apps/web/.env.example apps/web/.env   # once
npm run dev -w apps/web      # http://localhost:5173
npm test -w apps/web         # component and unit tests (Vitest + Testing Library, jsdom)
npm run build -w apps/web    # production build in apps/web/dist
```

The dev server is fixed to port 5173 (`strictPort`). The API's CORS allows exactly `WEB_ORIGIN`, which is `http://localhost:5173` in local development, so the web app must not drift to another port.

## Layout

```text
src/
  app/          routes, layout, providers (React Router data mode, TanStack Query)
  components/   shared UI components
  features/     one folder per area: auth, onboarding, dashboard, orders, customers, products, settings
  lib/          API client, Supabase client, formatters, query client, UI strings
  test/         Vitest setup
```

- All user-facing text lives in `src/lib/strings.ts` (§6.9), so Sinhala and Tamil can be added later.
- Mutations never retry automatically; retries of money-changing requests go through the `Idempotency-Key` (§9.8).
- React Router v8: import `RouterProvider` from `react-router/dom` and everything else from `react-router`.
- Tests sit next to the code as `*.test.ts(x)`.

## Environment

Every `VITE_` variable is compiled into the JavaScript that browsers download, so `apps/web/.env` holds public values only: the API URL, the Supabase URL and the public anon (publishable) key. `vite.config.ts` runs `src/lib/env-guard.ts` and refuses to start or build if a `VITE_` variable's name looks like a secret (service role, secret, password, database URL). The Supabase service-role key never belongs here.
