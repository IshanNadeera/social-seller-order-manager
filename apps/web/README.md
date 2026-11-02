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

## Authentication (A19)

Sign-up, log in, log out and password reset use `supabase-js` against Supabase Auth (§2.1, §11.2). The API never sees a password.

- `src/lib/supabase.ts` is the only place a Supabase client is created, and it exports **only** `supabase.auth`. ESLint forbids importing `@supabase/supabase-js` anywhere else (type imports aside), so the browser cannot query `app` tables (§23 rule 9). Components get the client from `useAuth()`.
- `src/features/auth/AuthProvider.tsx` mirrors the session for the UI. supabase-js stores it in the browser and refreshes the access token itself. On sign-out (from the button, an expired refresh token, or another tab) all cached API data is cleared.
- Routes (`src/app/routes.tsx`):
  - everything under `/` sits behind `RequireAuth`, which sends signed-out visitors to `/login` and brings them back afterwards (internal paths only: `safeReturnPath`);
  - `/login`, `/signup` and `/forgot-password` send signed-in users on to the app;
  - `/auth/confirm` and `/auth/reset-password` are the targets of email links.
- **Email links.** The templates in `supabase/templates/` link to `{SiteURL}/auth/confirm?token_hash=…&type=email|recovery`. That page calls `verifyOtp` once, then goes to the dashboard (sign-up) or to the new-password form (reset).
  - These links work in any browser or device, including an email app's built-in browser. The default PKCE redirect links work only in the browser that asked for them.
  - No token is ever put in a URL fragment, and the token hash is removed from the address bar after use.
  - **Staging and production:** paste the same two templates into the hosted project (Auth → Email Templates), and set the Site URL to the web origin (F3/F4).
- Log out ends the session on this device and revokes its refresh token (`signOut({ scope: 'local' })`). "Sign out of all devices" comes with Settings (E5).
- Messages: Supabase's error text is never shown. `auth-errors.ts` maps error codes to the plain-language strings in `strings.ts`. Sign-up and "forgot password" answer the same way whether or not an account exists.
- Tests use `src/test/fake-auth.ts` (an in-memory auth client) and `src/test/render-app.tsx` (the real routes in a memory router), so no Supabase server is needed.

### Trying it locally

1. `npm run db:start` (restart with `npm run db:stop` first after changing `supabase/config.toml`).
2. `npm run dev -w apps/web`, then open http://localhost:5173/signup.
3. Confirmation and reset emails arrive in Mailpit at http://127.0.0.1:54324.

## Talking to the API (A20)

- `src/lib/api-client.ts` is the only way to call the API. Components use `useApi()`, never `fetch()`.
  - It reads the Supabase session on **every** request and sends `Authorization: Bearer <access token>`, so a refreshed token is always used. With no session it throws without sending anything.
  - It sends JSON with no cookies (`credentials: 'omit'`), gives up after 20 s, and adds `Idempotency-Key` when asked (orders and payments, §9.8).
  - Every failure becomes an `ApiError` with `{ status, code, message, fieldErrors, requestId }`. Server messages for 4xx are shown as they are, since the API writes them for sellers. 5xx and network problems get generic text. `requestId` is shown as a reference number for support (`ApiErrorMessage`).
- Queries are retried once, and only after a network or server error (`shouldRetryQuery`). Mutations are never retried automatically.
- `GET /me` is loaded by `useMe()`. Its cache key includes the user ID.
- Routing:
  - `RequireBusiness` waits for `/me` and sends users with `needsOnboarding` to `/onboarding`. If `/me` fails, it shows an error with Retry and Log out.
  - `/onboarding` creates the business with `POST /onboarding`, using the **shared** `onboardingRequestSchema`, so the form and the API apply the same rules and messages.
  - The order prefix is suggested from the business name until the seller edits it, and a live preview shows `NIM-0001`.
  - The response (the new `/me`) goes straight into the cache, then the seller lands on the dashboard.
- Tests run the real API client over a fake `fetch` (`src/test/fake-api.ts`), so they check the exact requests, including the Bearer header.

## App shell and navigation (A21)

- The navigation is defined once in `src/app/navigation.ts` (`NAV_ITEMS`, `DESKTOP_NAV`, `MOBILE_NAV`, `MORE_NAV`). Add a section there, not in the layout.
- `src/app/RootLayout.tsx` is the frame for every signed-in screen (§6.1):
  - **Desktop (md, 768 px and up):** a fixed side navigation with the business name, a **+ New order** button, Dashboard · Orders · Customers · Products · Reports · Settings, and Log out.
  - **Mobile:** a top bar with the business name, and a bottom bar with Dashboard · Orders · **+ New order** (raised, centre) · Customers · More. **More** (`/more`) lists Products, Reports, Settings and Log out.
  - The bottom bar sits above the iPhone home indicator (`env(safe-area-inset-bottom)`, with `viewport-fit=cover` in `index.html`). The page has bottom padding so the bar never covers content.
- **Accessibility (§6.9):**
  - the current section has `aria-current="page"`;
  - every icon has a visible text label and is hidden from screen readers;
  - a "Skip to main content" link comes first, and focus rings are visible;
  - tap targets are at least 44 px.
- Sections not built yet show `PlaceholderPage` (orders C13–C15, products B7, reports E3, settings E5), so no link leads to "Page not found".
- **All UI text lives in `src/lib/strings.ts`.** `src/lib/ui-strings.test.ts` parses every component with the TypeScript parser. It fails on text written between JSX tags, or in `aria-label`, `alt`, `title`, `placeholder`, `label`, `hint`, `message` or `pendingLabel`. Icons are inline SVGs in `src/components/icons.tsx`, with no icon package.

## Customers (B6)

`src/features/customers/` (§6.6, §9.2):

| Path                          | Screen                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `/customers`                  | Search by name or phone, cards on mobile, a table from `md` up, 25 per page. |
| `/customers/new`              | Add a customer, optionally with a first delivery address.                    |
| `/customers/:customerId`      | Details, order count, last order date, addresses; archive.                   |
| `/customers/:customerId/edit` | Edit the customer.                                                           |

- **The list's state is in the URL** (`?q=&page=&archived=1`), so Back and refresh keep it. The search runs once typing pauses for 300 ms (`SEARCH_DELAY_MS` in `components/SearchBox.tsx`), or at once on Enter. A new search or filter goes back to page 1.
- **Data:** `api.ts` holds the TanStack Query hooks. Cache keys include the business ID, so one business's customers can never show for another on the same device. Every customer and address change answers with the whole customer (`CustomerDetail`). `useCustomerSaved()` puts that into the cache and refetches the lists.
- **Forms** use the shared schemas from `@ssom/shared` (`customerCreateSchema`, `addressCreateSchema`), so the browser and the API apply the same rules and messages.
  - Edits send only the fields that changed, and nothing at all when none did.
  - A field error from the API is shown next to its field (`lib/form-errors.ts`); other errors go in an alert with the reference number. What was typed is never lost.
  - The "Add a delivery address" section starts with the customer's name and phone. Closing it again sends no address (`shouldUnregister`).
- **Addresses:** the default comes first. Each card offers Make default, Edit and Remove. The API keeps exactly one default, and the screen just shows what it returns.
- **Archiving** a customer or an address asks first (`components/ConfirmDialog.tsx`). Focus starts on Cancel, Tab stays inside the dialog, Escape cancels, and focus returns to the button afterwards. A failed attempt shows its reason in the dialog. An archived customer is shown read-only.
- Dates show on the business's calendar (`lib/format.ts`, from `/me`'s timezone).
- Not here yet: the order history list (C16) and the district picker (B8). District is free text for now.
- Tests: `customers.test.tsx` runs the real routes and API client over the fake fetch, so it checks the exact requests. In `src/test/fake-api.ts`, a handler registered for a path without a query string also answers requests with one; read `call.path` for the query.

## Products (B7)

`src/features/products/` (§6.7, §9.3):

| Path                   | Screen                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `/products`            | Search by name or SKU, cards on mobile, a table from `md` up, 25 per page, "Show archived". |
| `/products/new`        | Add a product: name, selling price, SKU (optional), description (optional).                 |
| `/products/:productId` | Edit, or archive with confirmation. An archived product is shown read-only.                 |

- **No inventory fields** (§6.7). A product has nothing else to show, so it has no separate detail page.
- **Money is a string end to end (§7.5).**
  - The price is a text input (decimal keypad), checked by the shared `moneySchema` and sent as `"1500.00"`.
  - It is shown with `formatMoney(amount, currency)` (`lib/money.ts`), which groups the digits on the text and never makes a JavaScript number.
  - The currency comes from the business (`useBusinessCurrency()`).
- A SKU clash (409 `SKU_TAKEN`) is shown next to the SKU field. Saving goes back to the list. Edits send only the changed fields.
- **Shared with customers:**
  - `components/SearchBox.tsx` (search as you type);
  - `lib/use-list-params.ts` (`?q=&page=&archived=1` in the URL, and `listApiPath()` for the API request);
  - `features/account/use-business.ts` (business ID for cache keys, timezone, currency).
- Tests: `products.test.tsx` and `lib/money.test.ts`.
