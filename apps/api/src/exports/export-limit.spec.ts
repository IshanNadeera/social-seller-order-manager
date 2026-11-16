import { describe, expect, it } from 'vitest';
import { ExportLimit } from './export-limit';

describe('ExportLimit (§11.4)', () => {
  it('allows 10 exports in any hour per business, then says how long to wait', () => {
    let now = 0;
    const limit = new ExportLimit(() => now);
    for (let i = 0; i < 10; i += 1) {
      expect(limit.waitSeconds('a')).toBeNull();
      limit.record('a');
      now += 60_000; // one a minute
    }
    // The 11th, ten minutes after the first: wait until the first is an hour old.
    expect(limit.waitSeconds('a')).toBe(50 * 60);
    // Another business is not affected.
    expect(limit.waitSeconds('b')).toBeNull();
    // An hour after the first, one export is allowed again.
    now = 60 * 60 * 1000 + 1;
    expect(limit.waitSeconds('a')).toBeNull();
  });
});
