# apps/api

NestJS + TypeScript API with Prisma 7. This is the only part of the system that talks to the database (schema `app` on Supabase Postgres).
Verifies Supabase access tokens via JWKS; takes the business scope from the verified membership, never from the client.

Scaffolded in task A4. Prisma schema and migrations land in `apps/api/prisma/` (tasks A9–A11). See `docs/DEVELOPMENT.md` §8, §9 and §10.
