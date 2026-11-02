# ADR-024: Request validation with shared Zod schemas instead of class-validator DTOs

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §9.8, §6.4, §10.1

## Context

§9.8 asks for DTOs with NestJS `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), and OpenAPI generated from DTOs. The web app validates the same forms with React Hook Form + Zod (§10.1). Two sets of rules (class-validator in the API, Zod in the web) would drift: different limits, different messages.

## Options considered

- **class-validator DTOs in the API, Zod in the web**: the blueprint as written, but the rules are duplicated.
- **Shared Zod schemas in `packages/shared`, used by both**, with strict objects that refuse unknown fields.

## Decision

Request bodies and query strings are validated with **shared Zod schemas** (`packages/shared`), through the API's `ZodBodyPipe` and `ZodQueryPipe`.

- Schemas are strict: unknown fields are **refused** with a field error, which is the blueprint's `forbidNonWhitelisted` intent.
- Path IDs go through `IdParamPipe`, where a non-UUID gets the same 404 as a missing record.
- Errors use the §9.7 shape. Owner decision, task A16.

## Reason

One set of rules and plain-language messages for both the form and the API. The web form shows exactly what the API would reject.

## Consequences

- §9.8's "DTOs and ValidationPipe" wording should be updated.
- **OpenAPI** can't be generated from class-validator DTOs any more. Before the API docs task, choose a Zod-based generator, such as Zod 4's JSON Schema output or a NestJS Zod/OpenAPI package. Docs stay non-production only (§9.8).
