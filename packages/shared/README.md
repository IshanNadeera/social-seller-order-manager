# packages/shared

Code shared by the web app and the API: enums, constants, request/response types and Zod request schemas (display-stage labels come later). Not Prisma models. See `docs/DEVELOPMENT.md` §7 and §10.3.

## What's here

- `src/enums.ts`: order, payment, delivery and COD statuses; source channels; fulfilment types; payment methods; payment types; member roles; order event types. Each is a readonly list of codes (`ORDER_STATUSES`), a union type (`OrderStatus`) and a type guard (`isOrderStatus`). Use the list for Zod (`z.enum(ORDER_STATUSES)`) and select options.
- `src/constants.ts`: shared limits, such as `SOURCE_NOTE_MAX_LENGTH`.
- Codes only. Display labels belong in `apps/web/src/lib/strings.ts`, so they can be translated.
- The enum values must match the Prisma enums in `apps/api/prisma/schema.prisma`.

## How it is built and consumed

The package compiles to native ES modules in `dist/` (git-ignored). The web app imports it through Vite. The API is CommonJS and loads it with `require()`, which Node 26 supports for ES modules.

`dist/` is rebuilt automatically after `npm install`, before `npm run typecheck`, and before `dev`/`build` in either app. While you are changing this package, keep it rebuilding:

```bash
npm run dev -w @ssom/shared   # tsc --watch into dist/
npm test -w @ssom/shared      # unit tests (Vitest)
```

Vite picks up rebuilt files straight away; restart the API's dev server to load them. Relative imports inside `src/` end in `.js` (for example `./enums.js`), as native ES modules require.

## Phone numbers (`src/phone.ts`, §7.11, ADR-016)

- `normalizePhone(typed)` returns `{ display, normalized, warning }`, or `null` for an empty value.
  - `display` is what the seller typed, trimmed.
  - `normalized` is E.164 (`+94771234567`), parsed with `libphonenumber-js` and default country LK.
  - A number that can't be read gets `normalized: null` and `warning: 'PHONE_UNREADABLE'`. It is still saved; the seller is never blocked.
- `phoneSearchDigits(query)` gives the last 9 digits of a search, or `null` if there are fewer. Search matches stored numbers however they were written.
- It accepts `0771234567`, `771234567`, `+94 77 123 4567`, `0094771234567` and `94771234567`, with spaces, dashes, dots or brackets, plus foreign numbers written with `+` and their country code.
- It uses the library's small `min` metadata, which checks number length and leading-digit patterns, so the web bundle stays small.

## Request schemas (`src/schemas/`, ADR-024)

- Strict Zod schemas for request bodies and query strings, used by the API pipes (`ZodBodyPipe`, `ZodQueryPipe`) and by the web forms, so both apply the same rules and plain-language messages.
- `schemas/onboarding.ts`: `onboardingRequestSchema`.
- `schemas/customers.ts`: `customerCreateSchema` (with an optional first `address`), `customerUpdateSchema`, `customerListQuerySchema` and `addressInputSchema`, plus their limits (`CUSTOMER_NAME_MAX_LENGTH`, `MAX_PAGE_SIZE`, …).
  - Blank optional text becomes `null`, so clearing a form field clears the value. Emails are lower-cased.
- Response types are in `src/api.ts` (`Page`, `CustomerSummary`, `CustomerDetail`, `CustomerAddressView`, …).
