# ADR-003: Authentication: Supabase Auth, API verifies JWTs via JWKS

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §9.1, §11.2, §12.1

## Context

Sellers need sign-up with email verification, login, logout and password reset. Writing and securing password storage, reset tokens and email flows ourselves is risky. The API must still know who is calling, and which business they belong to, on every request.

## Options considered

- **Own auth in NestJS** (passport + bcrypt + our own reset emails): full control, but a large security surface.
- **Third-party identity provider** (Auth0, Clerk): mature, but another vendor and cost.
- **Supabase Auth, API verifies with the shared HS256 secret**: simple, but the API would hold a secret that can mint tokens.
- **Supabase Auth, API verifies with asymmetric signing keys (JWKS)**: the API holds only public keys.

## Decision

The browser uses **Supabase Auth** through `supabase-js` (sign-up, confirmation, login, logout, reset). The API never handles passwords. `AuthGuard` verifies the Bearer token with `jose` against Supabase's **JWKS**:

- ES256/RS256 signatures only;
- `iss` = `SUPABASE_JWT_ISSUER`, `aud` = `authenticated`, plus expiry;
- the JWKS is cached.

It then loads the caller's membership (ADR-026).

## Reason

No password handling in our code, email verification and reset are included, and verifying with public keys means a leaked API configuration cannot be used to forge tokens.

## Consequences

- Staging and production must use **asymmetric** JWT signing keys, never the legacy shared secret (task F3).
- If the JWKS cannot be fetched, the API answers 503 rather than 401, so an outage does not look like a logout.
- Bearer tokens (not cookies) mean no CSRF protection is needed. Tokens in browser storage are exposed to XSS, so a strict CSP and no `dangerouslySetInnerHTML` are required (task F6).
- Anonymous Supabase users are refused.
- Custom SMTP must be configured before the pilot (task F4). Email templates link to `/auth/confirm` (ADR-027).
