// Verifies Supabase access tokens (docs/DEVELOPMENT.md §11.2, ADR-003).
import { errors, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

/** Asymmetric algorithms Supabase signs with. HS256 (shared secret) and "none" are never accepted. */
export const ACCEPTED_ALGORITHMS = ['ES256', 'RS256'];
/** `aud` of Supabase access tokens for signed-in users. */
export const SUPABASE_AUDIENCE = 'authenticated';
/** Allowed clock difference between Supabase and this server when checking exp / nbf / iat. */
export const CLOCK_TOLERANCE_SECONDS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller, as proven by a valid access token. Business membership is added by A14. */
export interface VerifiedUser {
  /** Supabase Auth user ID (`sub`); equals app.users.id. */
  userId: string;
  email: string | null;
  sessionId: string | null;
}

/** The token is missing, malformed, expired, or not ours. Maps to 401. */
export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';
}

/** Supabase's signing keys could not be fetched; the token was not judged. Maps to 503. */
export class SigningKeysUnavailableError extends Error {
  override name = 'SigningKeysUnavailableError';
}

/** Marks a failure inside the key lookup that is about reaching the keys, not about the token. */
class KeyLookupFailed extends Error {}

/**
 * True when a key-lookup error means the key set could not be fetched or read (network error,
 * timeout, non-200 response, unreadable JSON), as opposed to the token naming an unknown key.
 */
function isKeyFetchFailure(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) return true; // e.g. TypeError: fetch failed
  return (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    error.code === 'ERR_JOSE_GENERIC' // e.g. the key endpoint answered with a non-200 status
  );
}

/** Wraps the key resolver so fetch failures can be told apart from everything else jwtVerify throws. */
function trackKeyFetchFailures(keys: JWTVerifyGetKey): JWTVerifyGetKey {
  return async (header, token) => {
    try {
      return await keys(header, token);
    } catch (error) {
      throw isKeyFetchFailure(error)
        ? new KeyLookupFailed('key lookup failed', { cause: error })
        : error;
    }
  };
}

/** A short, token-free reason for logs. */
function reasonOf(error: unknown): string {
  return error instanceof errors.JOSEError ? error.code : 'ERR_UNKNOWN';
}

export class SupabaseJwtVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    keys: JWTVerifyGetKey,
    private readonly issuer: string,
  ) {
    this.keys = trackKeyFetchFailures(keys);
  }

  /**
   * Checks the signature against Supabase's keys, the issuer, `aud = authenticated`, expiry and
   * not-before, then returns the user. Throws InvalidTokenError or SigningKeysUnavailableError.
   */
  async verify(token: string): Promise<VerifiedUser> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: SUPABASE_AUDIENCE,
        algorithms: ACCEPTED_ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      if (error instanceof KeyLookupFailed) {
        throw new SigningKeysUnavailableError('Could not fetch the Supabase signing keys.', {
          cause: error.cause,
        });
      }
      throw new InvalidTokenError(reasonOf(error), { cause: error });
    }

    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw new InvalidTokenError('ERR_SUBJECT_NOT_A_USER_ID');
    }
    // Anonymous sign-ins are off (supabase/config.toml); refuse such tokens if one ever appears.
    if (payload['is_anonymous'] === true) {
      throw new InvalidTokenError('ERR_ANONYMOUS_USER');
    }

    const email = payload['email'];
    const sessionId = payload['session_id'];
    return {
      userId: payload.sub.toLowerCase(),
      email: typeof email === 'string' && email !== '' ? email.toLowerCase() : null,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
    };
  }
}
