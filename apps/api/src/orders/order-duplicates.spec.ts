import { describe, expect, it } from 'vitest';
import { similarTotals } from './order-duplicates';

describe('similarTotals (§2.2)', () => {
  it('counts totals within 10% of the larger as similar', () => {
    expect(similarTotals(245000n, 245000n)).toBe(true);
    expect(similarTotals(245000n, 220500n)).toBe(true); // 24,500 off: exactly 10%
    expect(similarTotals(220500n, 245000n)).toBe(true); // either way round
    expect(similarTotals(245000n, 220000n)).toBe(false); // 25,000 off: just over
    expect(similarTotals(0n, 0n)).toBe(true);
    expect(similarTotals(0n, 100n)).toBe(false);
  });
});
