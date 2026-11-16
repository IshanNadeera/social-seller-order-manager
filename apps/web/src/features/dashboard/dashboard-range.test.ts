import { describe, expect, it } from 'vitest';
import {
  addDays,
  presetOf,
  presetRange,
  rangeProblem,
  readRange,
  todayIn,
} from './dashboard-range';

describe('dashboard period (§6.2)', () => {
  it('today is the business’s date, not the browser’s or UTC’s', () => {
    expect(todayIn('Asia/Colombo', new Date('2026-10-31T18:45:00Z'))).toBe('2026-11-01');
  });

  it('adds days across months and leap years', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('works out each preset from today, and recognises it again', () => {
    const today = '2026-11-16';
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('last7', today)).toEqual({ from: '2026-11-10', to: today });
    expect(presetRange('last30', today)).toEqual({ from: '2026-10-18', to: today });
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: today });
    expect(presetOf({ from: '2026-11-10', to: today }, today)).toBe('last7');
    expect(presetOf({ from: '2026-11-02', to: today }, today)).toBeNull();
  });

  it('reads the period from the URL, else today', () => {
    const today = '2026-11-16';
    expect(readRange(new URLSearchParams('from=2026-10-01&to=2026-10-31'), today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    for (const query of ['', 'from=2026-10-01', 'from=2026-02-30&to=2026-03-01']) {
      expect(readRange(new URLSearchParams(query), today)).toEqual({ from: today, to: today });
    }
  });

  it('uses the API’s rules for a range', () => {
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-31' })).toBeNull();
    expect(rangeProblem({ from: '2026-10-31', to: '2026-10-01' })).toBe(
      'The end date must be on or after the start date.',
    );
    expect(rangeProblem({ from: '2025-01-01', to: '2026-10-01' })).toBe(
      'Choose a range of at most 366 days.',
    );
  });
});
