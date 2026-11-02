import { describe, expect, it } from 'vitest';
import { inclusiveDays, isIsoDate, localDateRangeToUtc, startOfLocalDay } from './index.js';

describe('isIsoDate', () => {
  it.each(['2026-10-01', '2024-02-29', '2026-12-31'])('accepts %s', (date) => {
    expect(isIsoDate(date)).toBe(true);
  });
  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-10-32',
    '26-10-01',
    '2026-1-1',
    '2026-10-01T00:00',
    '',
  ])('refuses %s', (date) => {
    expect(isIsoDate(date)).toBe(false);
  });
});

describe('inclusiveDays', () => {
  it('counts both ends', () => {
    expect(inclusiveDays('2026-10-01', '2026-10-01')).toBe(1);
    expect(inclusiveDays('2026-10-01', '2026-10-31')).toBe(31);
    expect(inclusiveDays('2026-01-01', '2026-12-31')).toBe(365);
    expect(inclusiveDays('2024-01-01', '2024-12-31')).toBe(366);
  });
});

describe('local dates → UTC bounds (ADR-015)', () => {
  it('midnight in Colombo is 18:30 UTC the day before', () => {
    expect(startOfLocalDay('2026-11-01', 'Asia/Colombo').toISOString()).toBe(
      '2026-10-31T18:30:00.000Z',
    );
  });

  it('a range is [from 00:00 local, to + 1 day 00:00 local)', () => {
    expect(localDateRangeToUtc({ from: '2026-10-01', to: '2026-10-31' }, 'Asia/Colombo')).toEqual({
      gte: new Date('2026-09-30T18:30:00.000Z'),
      lt: new Date('2026-10-31T18:30:00.000Z'),
    });
  });

  it('works for one side only, and for other zones (with daylight saving)', () => {
    expect(localDateRangeToUtc({ to: '2026-12-31' }, 'UTC')).toEqual({
      lt: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(localDateRangeToUtc({}, 'Asia/Colombo')).toEqual({});
    // London is UTC+1 in summer, UTC+0 in winter.
    expect(startOfLocalDay('2026-07-01', 'Europe/London').toISOString()).toBe(
      '2026-06-30T23:00:00.000Z',
    );
    expect(startOfLocalDay('2026-12-01', 'Europe/London').toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });
});
