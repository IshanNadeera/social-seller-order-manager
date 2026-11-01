# packages/shared

Code shared by the web app and the API: enums, constants, and later request/response types, display-stage labels and Zod schemas. Not Prisma models. See `docs/DEVELOPMENT.md` §7 and §10.3.

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
