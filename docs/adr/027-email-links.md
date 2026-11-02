# ADR-027: Auth email links open /auth/confirm with a token hash

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §11.2, §2.1, ADR-003

## Context

Confirmation and password-reset emails must work on phones. Supabase's default PKCE links work only in the browser that requested them. Many sellers open email in an email app's built-in browser, or on another device.

## Options considered

- **Default PKCE redirect links**: fail across browsers and devices.
- **Implicit-flow links with tokens in the URL fragment**: tokens end up in the address bar and history.
- **Custom email templates linking to `{SiteURL}/auth/confirm?token_hash=…&type=email|recovery`, verified by the page with `verifyOtp`.**

## Decision

Use custom templates (`supabase/templates/confirmation.html`, `recovery.html`).

- `/auth/confirm` calls `supabase.auth.verifyOtp` once, then goes to the dashboard or to the new-password form.
- The supabase-js client uses `detectSessionInUrl: false`, and the token hash is removed from the address bar after use.
- The local config lists `/auth/confirm` as the redirect URL, and `scripts/check-supabase-config.mjs` checks the templates. Task A19.

## Reason

Links work in any browser or device, and no access token ever appears in a URL.

## Consequences

- **Staging and production:** the same two templates must be pasted into each hosted project's Auth email templates, and the Site URL set to the web origin (tasks F3, F4).
- The link works once and expires after an hour, with a "send a new link" path.
