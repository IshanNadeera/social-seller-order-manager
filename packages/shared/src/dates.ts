// Calendar dates in the business timezone (docs/DEVELOPMENT.md §8.1, §9.5, ADR-015). Stored times
// are UTC; filters take local dates ("2026-10-01") and turn them into exact UTC bounds.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is refused). */
export function isIsoDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Days from `from` to `to`, counting both (2026-10-01 to 2026-10-31 → 31). */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Milliseconds the zone is ahead of UTC at `instant` (Asia/Colombo: +5:30). */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - (instant - (instant % 1000));
}

/** The UTC instant of 00:00 on `date` in `timeZone`. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const wallClock = Date.parse(`${date}T00:00:00Z`);
  let instant = wallClock - zoneOffset(wallClock, timeZone);
  // Again with the offset at the result, in case the zone changed offset in between (DST).
  instant = wallClock - zoneOffset(instant, timeZone);
  return new Date(instant);
}

/**
 * `from`/`to` local dates (both included) → UTC bounds `[gte, lt)`: from 00:00 local on `from` to
 * 00:00 local on the day after `to` (§9.5). Either side may be missing.
 */
export function localDateRangeToUtc(
  range: { from?: string; to?: string },
  timeZone: string,
): { gte?: Date; lt?: Date } {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (range.from !== undefined) bounds.gte = startOfLocalDay(range.from, timeZone);
  if (range.to !== undefined) {
    const next = new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    bounds.lt = startOfLocalDay(next, timeZone);
  }
  return bounds;
}
