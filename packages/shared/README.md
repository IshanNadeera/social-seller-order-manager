# packages/shared

Code shared by the web app and the API: enums, constants, request/response types, Zod request schemas and the display stage. Not Prisma models. See `docs/DEVELOPMENT.md` §7 and §10.3.

## What's here

- `src/enums.ts`: order, payment, delivery and COD statuses; source channels; fulfilment types; payment methods; payment types; member roles; order event types. Each is a readonly list of codes (`ORDER_STATUSES`), a union type (`OrderStatus`) and a type guard (`isOrderStatus`). Use the list for Zod (`z.enum(ORDER_STATUSES)`) and select options.
- `src/constants.ts`: shared limits, such as `SOURCE_NOTE_MAX_LENGTH`.
- `src/stage.ts`: `orderStage(orderStatus, deliveryStatus)` gives the display stage of §7.3 as a code (`OUT_FOR_DELIVERY`, …); `deliveryStatus` is null for pickup orders. `ORDER_STAGE_LABELS` holds the English labels for the CSV export; the web app labels stages in its `strings.ts`. Pairs the workflow can't produce fall back to the order status, so screens never break.
- `src/districts.ts`: `SRI_LANKA_DISTRICTS`, the 25 districts in alphabetical order with standard spellings (§7.11), plus the `SriLankaDistrict` type, `isSriLankaDistrict()` and `toSriLankaDistrict()` (finds the standard spelling, ignoring case and spaces). Display names live in the web app's `strings.ts`.
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
- `schemas/customers.ts`: `customerCreateSchema` (with an optional first `address`), `customerUpdateSchema`, `customerListQuerySchema`, `addressCreateSchema` and `addressUpdateSchema`, plus their limits (`CUSTOMER_NAME_MAX_LENGTH`, `MAX_PAGE_SIZE`, `MAX_ACTIVE_ADDRESSES`, …).
  - Blank optional text becomes `null`, so clearing a form field clears the value. Emails are lower-cased.
  - An address `district` must be one of the 25 or empty. Any capitalisation is stored with the standard spelling (`kandy` → `Kandy`); anything else gets "Choose a district from the list." The column stays text.
  - Update schemas refuse an empty body ("Change at least one field."), but only when every field is valid, so an invalid field is reported alone.
- `schemas/products.ts`: `productCreateSchema`, `productUpdateSchema`, `productListQuerySchema`.
- `schemas/money.ts`: `moneySchema()` for amounts sent as strings (`"1500.00"`, 0 to 99,999,999.99, at most 2 decimals; output normalised to two decimals) and `toMoneyString()`. JSON numbers are refused (§7.5).
- `schemas/common.ts`: internal building blocks (blank → null, required/optional text, paged search query fields, "Change at least one field."). Only `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE` and `SEARCH_MAX_LENGTH` are exported from the package.
- Response types are in `src/api.ts` (`Page`, `CustomerSummary`, `CustomerDetail`, `CustomerAddressView`, `ProductView`, …).
- **Messages are written for sellers.** Every schema gives its own message for wrong types too (a number sent for a text field, a repeated `?q=`). `schemas/messages.test.ts` sends every field of every schema wrong values and fails on zod's built-in wording ("Invalid input: expected string…"). It covers new fields automatically; add new schemas to its list.
