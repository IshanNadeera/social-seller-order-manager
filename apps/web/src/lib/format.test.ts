import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatLocalDate, formatPercent } from './format';

describe('formatDate', () => {
  it('shows the date on the business calendar, not UTC', () => {
    // 20:00 UTC on 19 Oct is already 20 Oct in Sri Lanka (UTC+05:30).
    expect(formatDate('2026-10-19T20:00:00.000Z', 'Asia/Colombo')).toBe('20 Oct 2026');
    expect(formatDate('2026-10-19T20:00:00.000Z', 'UTC')).toBe('19 Oct 2026');
  });
});

describe('formatDateTime', () => {
  it('shows the time on the business clock', () => {
    // 06:00 UTC is 11:30 in Sri Lanka.
    expect(formatDateTime('2026-11-01T06:00:00.000Z', 'Asia/Colombo')).toBe('1 Nov 2026, 11:30');
  });
});

describe('formatLocalDate and formatPercent', () => {
  it('shows a business-calendar date as it is, whatever the browser’s zone', () => {
    expect(formatLocalDate('2026-11-01')).toBe('1 Nov 2026');
  });

  it('shows a share as a percentage', () => {
    expect(formatPercent(1 / 8)).toBe('12.5%');
    expect(formatPercent(0)).toBe('0%');
  });
});
