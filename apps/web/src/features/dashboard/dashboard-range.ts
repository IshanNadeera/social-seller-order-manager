// The dashboard period (docs/DEVELOPMENT.md §6.2, §15): two local dates in the business timezone,
// kept in the URL (?from=&to=) so a reload or a shared link shows the same period. No dates means
// today. Presets are worked out from today on the business's clock.
import { dashboardSummaryQuerySchema, isIsoDate, localDateOf } from '@ssom/shared';

export type DateRange = { from: string; to: string };

export const RANGE_PRESETS = ['today', 'last7', 'last30', 'thisMonth'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** `date` (YYYY-MM-DD) moved by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The local date in `timeZone` right now. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateOf(now, timeZone);
}

export function presetRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** The preset `range` is, if any. */
export function presetOf(range: DateRange, today: string): RangePreset | null {
  return (
    RANGE_PRESETS.find((preset) => {
      const candidate = presetRange(preset, today);
      return candidate.from === range.from && candidate.to === range.to;
    }) ?? null
  );
}

/** The period in the URL, or today when the URL has none (or only half of one). */
export function readRange(search: URLSearchParams, today: string): DateRange {
  const from = search.get('from');
  const to = search.get('to');
  if (from !== null && to !== null && isIsoDate(from) && isIsoDate(to)) return { from, to };
  return { from: today, to: today };
}

/** The first problem with `range` by the API's own rules, or null if it can be asked for. */
export function rangeProblem(range: DateRange): string | null {
  const result = dashboardSummaryQuerySchema.safeParse(range);
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}
