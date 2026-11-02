# ADR-015: Dates and time zone: UTC storage, business time zone for display and filters

- Status: Accepted
- Date: 2026-11-01
- Blueprint: §8.1, §9.5, §15

## Context

"Today" for a seller in Sri Lanka is different from "today" in UTC. Dashboard figures and date filters must match the seller's calendar.

## Options considered

- **Store local time**: ambiguous and hard to compare.
- **UTC everywhere, including filters**: the seller's evening orders land on the wrong day.
- **Store UTC; show and filter in the business time zone**, converting inclusive local dates to exclusive UTC bounds.

## Decision

Timestamps are `TIMESTAMPTZ` in UTC. Each business has a `timezone` (default `Asia/Colombo`). A filter `from`/`to` (YYYY-MM-DD, `to` inclusive) becomes `[from 00:00 local, to+1 00:00 local)` in UTC. The range is at most 366 days, and `from ≤ to`.

## Reason

It gives the correct "today" for sellers, with unambiguous storage.

## Consequences

- The date conversion has unit tests in Asia/Colombo (§12.1).
- Dashboard metrics use the same boundaries (§15).
