# ADR-026: Membership resolution: archived businesses ignored, oldest membership wins

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §4.2, §11.1, §11.2, §11.5

## Context

`AuthGuard` must turn a verified user into exactly one business scope. The schema allows several memberships, for STAFF later, and businesses can be archived at account closure (§11.5).

## Options considered

- **Refuse users with more than one membership**: blocks a future feature.
- **Let the client choose the business**: the client must never choose tenant scope (§11.1).
- **Ignore memberships in archived businesses, and use the oldest remaining membership.**

## Decision

One query loads `users.disabled_at` and the oldest membership in a non-archived business.

- If the user is disabled → 403 `ACCOUNT_DISABLED` on every route.
- If they have no membership, or no `users` row yet → 403 `ONBOARDING_REQUIRED`, except on `GET /me` and `POST /onboarding`.
- Otherwise `req.auth = { userId, businessId, role }` is the only source of tenant scope. Task A14.

## Reason

Deterministic, safe now (one OWNER per business in the MVP), and does not block team access later.

## Consequences

- Choosing between several businesses is a post-MVP feature and will need its own ADR.
- `businessId` from the request is banned by an ESLint rule and refused by strict schemas.
