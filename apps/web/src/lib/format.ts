// Formatting for display (docs/DEVELOPMENT.md §8.1: stored in UTC, shown in the business timezone).
import { strings } from './strings';

/** A date such as "20 Oct 2026", on the calendar of `timeZone` (the business's, e.g. Asia/Colombo). */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(strings.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/** A moment such as "1 Nov 2026, 11:30" (24-hour), on the clock of `timeZone`. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(strings.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

/** A calendar date already in the business timezone ("2026-10-20" → "20 Oct 2026"). */
export function formatLocalDate(date: string): string {
  // Midday UTC is the same calendar day everywhere the date could be read.
  return formatDate(`${date}T12:00:00Z`, 'UTC');
}

/** A share such as 0.125 → "12.5%". */
export function formatPercent(share: number): string {
  return new Intl.NumberFormat(strings.locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(share);
}
