import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { authErrorMessage } from './auth-errors';
import { safeReturnPath } from './redirect';
import { loginSchema, resetPasswordSchema, signUpSchema } from './schemas';

const errors = strings.auth.errors;

describe('safeReturnPath (no open redirects)', () => {
  it.each([
    [{ pathname: '/orders', search: '?status=READY', hash: '#top' }, '/orders?status=READY#top'],
    [{ pathname: '/customers/123' }, '/customers/123'],
    [{ pathname: '/orders', search: 'no-question-mark' }, '/orders'],
  ])('keeps internal path %j', (from, expected) => {
    expect(safeReturnPath(from)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    'https://evil.example',
    { pathname: 'https://evil.example' },
    { pathname: '//evil.example/x' },
    { pathname: '/\\evil.example' },
    { pathname: '/\nx' },
    { pathname: 42 },
    { pathname: '/login' },
    { pathname: '/signup' },
    { pathname: '/auth/confirm', search: '?token_hash=x' },
  ])('falls back to the dashboard for %j', (from) => {
    expect(safeReturnPath(from)).toBe('/');
  });
});

describe('authErrorMessage', () => {
  it.each([
    [{ code: 'invalid_credentials' }, errors.invalidCredentials],
    [{ code: 'email_not_confirmed' }, errors.emailNotConfirmed],
    [{ code: 'over_email_send_rate_limit', status: 429 }, errors.tooManyRequests],
    [{ code: 'otp_expired' }, errors.linkExpired],
    [{ status: 429 }, errors.tooManyRequests],
    [{ name: 'AuthRetryableFetchError', status: 0 }, errors.network],
    [new TypeError('Failed to fetch'), errors.network],
    [{ code: 'something_new', message: 'Raw Supabase text' }, errors.generic],
    ['oops', errors.generic],
  ])('maps %j to a plain message', (error, expected) => {
    expect(authErrorMessage(error)).toBe(expected);
  });
});

describe('form schemas', () => {
  it('normalises the email', () => {
    expect(loginSchema.parse({ email: ' A@B.Example ', password: 'x' }).email).toBe('a@b.example');
  });

  it('never trims passwords', () => {
    expect(loginSchema.parse({ email: 'a@b.example', password: ' pw ' }).password).toBe(' pw ');
  });

  it('allows 8 to 72 bytes for a new password', () => {
    const check = (password: string) =>
      signUpSchema.safeParse({ email: 'a@b.example', password, confirmPassword: password }).success;
    expect(check('1234567')).toBe(false);
    expect(check('12345678')).toBe(true);
    expect(check('x'.repeat(72))).toBe(true);
    expect(check('x'.repeat(73))).toBe(false);
    expect(check('අ'.repeat(25))).toBe(false); // 75 bytes in UTF-8, though only 25 characters
  });

  it('puts the mismatch error on the confirmation field', () => {
    const result = resetPasswordSchema.safeParse({ password: '12345678', confirmPassword: '12345679' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });
});
