# ADR-017: Idempotency keys on order, payment and COD settlement creation

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §9.8, §6.4

## Context

Weak mobile networks retry requests. A repeated "save order" or "record payment" must not create duplicates.

## Options considered

- **Disable the button only**: does not protect against network-level retries.
- **Duplicate detection by content**: guesswork.
- **A required `Idempotency-Key` header (a UUID from the browser) stored per business with the request hash and response.**

## Decision

`Idempotency-Key` is required on `POST /orders`, `POST /orders/:id/payments` and `POST /orders/:id/cod/settle`.

- The same key with the same body returns the stored response.
- The same key with a different body gets 409.
- Keys are stored in `idempotency_keys`, scoped by business, and deleted after 48 hours.

## Reason

Retries become safe without guessing.

## Consequences

- The web API client can send the header (task A20). Mutations never auto-retry; a retry reuses the key.
- Idempotency middleware is task C6. A scheduled cleanup job is needed.
