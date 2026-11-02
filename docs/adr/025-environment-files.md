# ADR-025: One .env.example per app, validated at startup

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §10.3, §10.4

## Context

§10.3's tree shows one `.env.example` at the root, while §10.4 lists separate variables for the API and the web app. The web app's variables are compiled into public JavaScript, so mixing them with server values in one file invites leaks.

## Options considered

- **One root `.env`** shared by both apps: convenient, but easy to leak a server value into a `VITE_` variable.
- **One `.env.example` and `.env` per app.**

## Decision

`apps/api/.env.example` and `apps/web/.env.example`, with placeholders only; `.env` files are git-ignored.

- The API validates its environment with Zod at startup. It lists problems by variable name, never by value, and refuses to start if any variable name contains `SERVICE_ROLE` or `SUPABASE_SECRET`.
- The web build refuses to start if a `VITE_` variable looks like a secret, and validates its public settings at load. Task A7.

## Reason

It keeps server secrets physically separate from values that ship to browsers.

## Consequences

- §10.3's tree should show the two files.
- Hosted environments set variables in the host's secret settings.
