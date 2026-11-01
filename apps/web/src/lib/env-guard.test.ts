import { describe, expect, it } from 'vitest';
import { assertNoSecretsExposed } from './env-guard';

describe('assertNoSecretsExposed', () => {
  it('allows the public variables from .env.example', () => {
    expect(() =>
      assertNoSecretsExposed({
        VITE_API_URL: 'http://localhost:3000/api/v1',
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: 'public-anon-key',
      }),
    ).not.toThrow();
  });

  it.each([
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SERVICE_ROLE_KEY',
    'VITE_supabase_service_role_key',
    'VITE_SUPABASE_SECRET_KEY',
    'VITE_DB_PASSWORD',
    'VITE_DATABASE_URL',
  ])('refuses %s', (key) => {
    expect(() => assertNoSecretsExposed({ [key]: 'value', VITE_API_URL: 'x' })).toThrow(key);
  });

  it('ignores variables that Vite does not expose', () => {
    expect(() =>
      assertNoSecretsExposed({ SUPABASE_SERVICE_ROLE_KEY: 'not exposed' }),
    ).not.toThrow();
  });

  it('names every offending variable but never prints values', () => {
    const secret = 'super-secret-value';
    let message = '';
    try {
      assertNoSecretsExposed({ VITE_SERVICE_ROLE_KEY: secret, VITE_SECRET: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('VITE_SECRET, VITE_SERVICE_ROLE_KEY');
    expect(message).not.toContain(secret);
  });
});
