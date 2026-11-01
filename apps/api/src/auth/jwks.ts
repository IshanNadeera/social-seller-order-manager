import { createRemoteJWKSet } from 'jose';
import type { Env } from '../common/env';

/** How long fetched signing keys are reused before being fetched again. */
export const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
/** After a fetch, an unknown key ID cannot trigger another fetch for this long (stops key-ID floods). */
export const JWKS_COOLDOWN_MS = 30 * 1000;
/** Give up on a slow key fetch after this long (the request then gets 503, not 401). */
export const JWKS_TIMEOUT_MS = 5 * 1000;

export function supabaseJwksUrl(env: Pick<Env, 'SUPABASE_URL'>): URL {
  return new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL);
}

/**
 * Supabase's public signing keys (§11.2, ADR-003). jose caches them in memory and refetches only
 * when the cache expires or a token names a key ID it has not seen (key rotation), at most once
 * per cooldown. The API never holds a shared JWT secret.
 */
export function createSupabaseJwks(env: Pick<Env, 'SUPABASE_URL'>) {
  return createRemoteJWKSet(supabaseJwksUrl(env), {
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    timeoutDuration: JWKS_TIMEOUT_MS,
  });
}
