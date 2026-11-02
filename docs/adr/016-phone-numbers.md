# ADR-016: Phone numbers: libphonenumber-js, default LK, E.164 plus display copy

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §7.11

## Context

Sellers type numbers in many forms (0771234567, +94 77 123 4567, 0094…). Search must find a customer whatever form was used, without blocking unusual numbers.

## Options considered

- **Store as typed**: search misses matches.
- **Strict validation**: blocks real but unusual numbers.
- **Normalise with libphonenumber-js (default LK) to E.164, keep the typed form, and save unparseable numbers with a warning.**

## Decision

Store `phone_display` (as typed) and `phone_normalized` (E.164 or NULL). An unparseable number is saved with `phone_normalized = NULL` and a warning; it is never blocked. Search uses the normalised form and also matches the last 9 digits.

## Reason

Reliable search without guessing, and the seller is never blocked.

## Consequences

- Unit tests cover the Sri Lankan formats and invalid numbers (task B1).
- Phone numbers are not unique, since families share them.
- Logs mask phones (§11.5).
