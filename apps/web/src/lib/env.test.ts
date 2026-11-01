import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

const valid = {
  VITE_API_URL: 'http://localhost:3000/api/v1/',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
};

describe('parseWebEnv', () => {
  it('returns the settings, without trailing slashes', () => {
    expect(parseWebEnv(valid)).toEqual({
      apiUrl: 'http://localhost:3000/api/v1',
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: valid.VITE_SUPABASE_ANON_KEY,
    });
  });

  it('names every missing or invalid variable, without printing values', () => {
    const run = () =>
      parseWebEnv({ VITE_API_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'too-short' });
    expect(run).toThrow(/VITE_API_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL/);
    expect(run).not.toThrow(/not a url|too-short/);
  });

  it('refuses non-http URLs', () => {
    expect(() => parseWebEnv({ ...valid, VITE_API_URL: 'javascript:alert(1)' })).toThrow(
      /VITE_API_URL/,
    );
  });
});
