import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  WEB_ORIGIN: 'http://localhost:5173',
};

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:pw@db.example.com:5432/postgres',
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_JWT_ISSUER: 'https://abcdefgh.supabase.co/auth/v1',
  WEB_ORIGIN: 'https://app.example.com',
};

/** Runs parseEnv and returns the reported problems (empty if it parsed). */
function problemsFor(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseEnv(source);
    return [];
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
}

/** Asserts that exactly one problem is reported and that it matches the pattern. */
function expectOneProblem(source: Record<string, string | undefined>, pattern: RegExp): void {
  const problems = problemsFor(source);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(pattern);
}

describe('parseEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('converts PORT to a number', () => {
    expect(parseEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it('accepts a valid production environment', () => {
    expect(parseEnv(production).NODE_ENV).toBe('production');
  });

  it('ignores unrelated variables', () => {
    expect(parseEnv({ ...valid, HOME: '/Users/someone', PATH: '/usr/bin' })).not.toHaveProperty(
      'HOME',
    );
  });

  it('reports every missing required variable at once', () => {
    expect(problemsFor({})).toEqual([
      'DATABASE_URL: Required.',
      'SUPABASE_URL: Required.',
      'SUPABASE_JWT_ISSUER: Required.',
      'WEB_ORIGIN: Required.',
    ]);
  });

  it('treats empty values as missing', () => {
    expect(problemsFor({ ...valid, DATABASE_URL: '', PORT: '' })).toEqual([
      'DATABASE_URL: Required.',
    ]);
  });

  it.each(['abc', '0', '65536', '30.5', '-1'])('rejects PORT=%j', (port) => {
    expectOneProblem({ ...valid, PORT: port }, /^PORT: /);
  });

  it.each(['staging', 'prod', 'DEVELOPMENT'])('rejects NODE_ENV=%j', (nodeEnv) => {
    expectOneProblem({ ...valid, NODE_ENV: nodeEnv }, /^NODE_ENV: /);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expectOneProblem({ ...valid, LOG_LEVEL: 'verbose' }, /^LOG_LEVEL: /);
  });

  it.each(['mysql://u:p@host/db', 'not a url', 'https://example.com'])(
    'rejects DATABASE_URL that is not a postgres URL (%s)',
    (url) => {
      expectOneProblem({ ...valid, DATABASE_URL: url }, /^DATABASE_URL: /);
    },
  );

  it('accepts both postgres:// and postgresql://', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'postgres://u:p@host:5432/db' })).not.toThrow();
  });

  it.each([
    '*',
    'http://localhost:5173/',
    'http://localhost:5173/app',
    'https://*.example.com',
    'localhost:5173',
  ])('rejects WEB_ORIGIN=%j', (webOrigin) => {
    expectOneProblem({ ...valid, WEB_ORIGIN: webOrigin }, /^WEB_ORIGIN: Must be an exact origin/);
  });

  it.each(['http://127.0.0.1:54321/', 'https://abcdefgh.supabase.co/rest/v1'])(
    'rejects SUPABASE_URL=%j',
    (url) => {
      expectOneProblem({ ...valid, SUPABASE_URL: url }, /^SUPABASE_URL: /);
    },
  );

  it('rejects SUPABASE_JWT_ISSUER with a trailing slash', () => {
    expect(problemsFor({ ...valid, SUPABASE_JWT_ISSUER: `${valid.SUPABASE_JWT_ISSUER}/` })).toEqual(
      ['SUPABASE_JWT_ISSUER: Must not end with a slash.'],
    );
  });

  it('keeps SENTRY_DSN optional but checks it when set', () => {
    const dsn = 'https://key@o1.ingest.sentry.io/1';
    expect(parseEnv(valid).SENTRY_DSN).toBeUndefined();
    expect(parseEnv({ ...valid, SENTRY_DSN: dsn }).SENTRY_DSN).toBe(dsn);
    expectOneProblem({ ...valid, SENTRY_DSN: 'not a url' }, /^SENTRY_DSN: /);
  });

  it('requires https in production', () => {
    expect(
      problemsFor({
        ...production,
        SUPABASE_URL: 'http://abcdefgh.supabase.co',
        SUPABASE_JWT_ISSUER: 'http://abcdefgh.supabase.co/auth/v1',
        WEB_ORIGIN: 'http://app.example.com',
      }),
    ).toEqual([
      'SUPABASE_URL: Must use https in production.',
      'SUPABASE_JWT_ISSUER: Must use https in production.',
      'WEB_ORIGIN: Must use https in production.',
    ]);
  });

  it.each([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SERVICE_ROLE_KEY',
    'supabase_service_role_key',
    'SUPABASE_SECRET_KEY',
  ])('refuses to start when %s is set', (key) => {
    expectOneProblem({ ...valid, [key]: 'anything' }, new RegExp(`^${key}: Remove it`));
  });

  it('never includes variable values in the error message', () => {
    const secret = 'hunter2-not-a-real-password';
    let message = '';
    try {
      parseEnv({
        ...valid,
        DATABASE_URL: `mysql://user:${secret}@host/db`,
        SUPABASE_SERVICE_ROLE_KEY: secret,
        WEB_ORIGIN: `https://${secret}.example.com/path`,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(message).toContain('WEB_ORIGIN');
    expect(message).not.toContain(secret);
  });
});
