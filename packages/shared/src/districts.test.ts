import { describe, expect, it } from 'vitest';
import { SRI_LANKA_DISTRICTS, isSriLankaDistrict, toSriLankaDistrict } from './index.js';

describe('SRI_LANKA_DISTRICTS', () => {
  it('has the 25 districts, each once, in alphabetical order', () => {
    expect(SRI_LANKA_DISTRICTS).toHaveLength(25);
    expect(new Set(SRI_LANKA_DISTRICTS).size).toBe(25);
    expect([...SRI_LANKA_DISTRICTS]).toEqual([...SRI_LANKA_DISTRICTS].sort());
  });

  it('uses the standard spellings', () => {
    expect(SRI_LANKA_DISTRICTS).toContain('Monaragala');
    expect(SRI_LANKA_DISTRICTS).toContain('Nuwara Eliya');
    expect(SRI_LANKA_DISTRICTS).toContain('Mullaitivu');
  });
});

describe('isSriLankaDistrict / toSriLankaDistrict', () => {
  it('recognises the exact names only', () => {
    expect(isSriLankaDistrict('Kandy')).toBe(true);
    expect(isSriLankaDistrict('kandy')).toBe(false);
    expect(isSriLankaDistrict(42)).toBe(false);
  });

  it('finds the standard spelling, ignoring case and extra spaces', () => {
    expect(toSriLankaDistrict(' kandy ')).toBe('Kandy');
    expect(toSriLankaDistrict('NUWARA   eliya')).toBe('Nuwara Eliya');
    expect(toSriLankaDistrict('Kandy City')).toBeNull();
  });
});
