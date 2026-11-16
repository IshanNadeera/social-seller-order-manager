// Writing CSV safely (docs/DEVELOPMENT.md §11.4). A value a spreadsheet would read as a formula —
// one starting with =, +, -, @, a tab or a carriage return — gets a leading apostrophe, so opening
// the file never runs anything a customer typed into a name or note. Values are then quoted when
// they hold a comma, a quote or a line break (RFC 4180).

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One cell: escaped against formula injection, then quoted if needed. Null is an empty cell. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One line of cells, ended with CRLF as RFC 4180 asks. */
export function csvRow(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/**
 * The start of the file: a byte-order mark, so Excel reads it as UTF-8 (Sinhala and Tamil names
 * included), then the header row.
 */
export function csvHeader(columns: readonly string[]): string {
  return `﻿${csvRow(columns)}`;
}

/** "2026-11-01 11:30": a moment on the business's clock, as spreadsheets sort it. */
export function localDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
