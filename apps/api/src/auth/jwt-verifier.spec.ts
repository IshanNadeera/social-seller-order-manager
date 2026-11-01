// Unit tests for Supabase access-token verification (docs/DEVELOPMENT.md §11.2, §12.1, ADR-003).
// Tokens are signed here with throwaway ES256 keys; no Supabase is needed.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWK, JWTPayload, JWTVerifyGetKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseJwks } from './jwks';
import {
  InvalidTokenError,
  SigningKeysUnavailableError,
  SupabaseJwtVerifier,
} from './jwt-verifier';

const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const USER_ID = '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b';
const KID = 'test-key-1';
const now = () => Math.floor(Date.now() / 1000);

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let privateKey: SigningKey;
let otherPrivateKey: SigningKey;
let publicJwk: JWK;
let keys: JWTVerifyGetKey;
let verifier: SupabaseJwtVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const other = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [publicJwk] });
  verifier = new SupabaseJwtVerifier(keys, ISSUER);
});

interface TokenOptions {
  claims?: JWTPayload;
  subject?: string | null;
  issuer?: string;
  audience?: string;
  issuedAt?: number;
  expiresAt?: number | null;
  notBefore?: number;
  kid?: string;
  key?: SigningKey;
}

/** A Supabase-shaped access token; options override one thing at a time. */
function token(options: TokenOptions = {}): Promise<string> {
  let jwt = new SignJWT({
    email: 'Seller@Example.test',
    role: 'authenticated',
    session_id: 'c1d2e3f4-0000-4000-8000-000000000001',
    is_anonymous: false,
    ...options.claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: options.kid ?? KID, typ: 'JWT' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? 'authenticated')
    .setIssuedAt(options.issuedAt ?? now());
  if (options.subject !== null) jwt = jwt.setSubject(options.subject ?? USER_ID);
  if (options.expiresAt !== null) jwt = jwt.setExpirationTime(options.expiresAt ?? now() + 3600);
  if (options.notBefore !== undefined) jwt = jwt.setNotBefore(options.notBefore);
  return jwt.sign(options.key ?? privateKey);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the token to be rejected');
}

async function expectInvalid(jwt: string | Promise<string>): Promise<void> {
  const error = await rejection(verifier.verify(await jwt));
  expect(error).toBeInstanceOf(InvalidTokenError);
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('SupabaseJwtVerifier', () => {
  // The five cases required by the build tracker (A13) and §12.1.
  it('accepts a valid token and returns the user', async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({
      userId: USER_ID,
      email: 'seller@example.test',
      sessionId: 'c1d2e3f4-0000-4000-8000-000000000001',
    });
  });

  it('rejects an expired token', async () => {
    await expectInvalid(token({ issuedAt: now() - 7200, expiresAt: now() - 60 }));
  });

  it('rejects a token from another issuer (another Supabase project)', async () => {
    await expectInvalid(token({ issuer: 'https://otherproject.supabase.co/auth/v1' }));
  });

  it('rejects a token with the wrong audience', async () => {
    await expectInvalid(token({ audience: 'anon' }));
  });

  it('rejects a token signed with a different key (bad signature)', async () => {
    await expectInvalid(token({ key: otherPrivateKey }));
  });

  // Further cases.
  it('rejects a token whose payload was altered after signing', async () => {
    const [header, , signature] = (await token()).split('.');
    const forged = base64url({
      sub: USER_ID,
      aud: 'authenticated',
      iss: ISSUER,
      exp: now() + 3600,
      iat: now(),
      role: 'service_role',
    });
    await expectInvalid(`${header}.${forged}.${signature}`);
  });

  it('rejects a token signed with a key ID Supabase does not publish', async () => {
    await expectInvalid(token({ kid: 'unknown-key' }));
  });

  it('rejects an unsigned token (alg "none")', async () => {
    const payload = {
      sub: USER_ID,
      aud: 'authenticated',
      iss: ISSUER,
      exp: now() + 3600,
      iat: now(),
    };
    await expectInvalid(`${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`);
  });

  it('rejects a shared-secret HS256 token', async () => {
    const secret = new TextEncoder().encode('legacy-shared-secret-that-must-not-work-0123');
    const hs256 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    await expectInvalid(hs256);
  });

  it('rejects a token without an expiry', async () => {
    await expectInvalid(token({ expiresAt: null }));
  });

  it('rejects a token that is not valid yet (nbf in the future)', async () => {
    await expectInvalid(token({ notBefore: now() + 600 }));
  });

  it('allows a few seconds of clock difference', async () => {
    await expect(verifier.verify(await token({ expiresAt: now() - 2 }))).resolves.toMatchObject({
      userId: USER_ID,
    });
  });

  it.each([
    ['missing', null],
    ['not a user ID', 'service_role'],
  ])('rejects a token whose subject is %s', async (_label, subject) => {
    await expectInvalid(token({ subject }));
  });

  it('rejects an anonymous user', async () => {
    await expectInvalid(token({ claims: { is_anonymous: true } }));
  });

  it.each(['', 'not-a-jwt', 'a.b.c', 'Bearer x'])('rejects the malformed token %j', async (jwt) => {
    await expectInvalid(jwt);
  });

  it('returns null email and session when the token has none', async () => {
    await expect(
      verifier.verify(await token({ claims: { email: '', session_id: undefined } })),
    ).resolves.toEqual({ userId: USER_ID, email: null, sessionId: null });
  });

  it('reports unreachable signing keys separately from a bad token', async () => {
    const unreachable: JWTVerifyGetKey = () => Promise.reject(new TypeError('fetch failed'));
    const error = await rejection(
      new SupabaseJwtVerifier(unreachable, ISSUER).verify(await token()),
    );
    expect(error).toBeInstanceOf(SigningKeysUnavailableError);
  });

  it('never puts the token in the error message', async () => {
    const jwt = await token({ key: otherPrivateKey });
    const error = await rejection(verifier.verify(jwt));
    expect(String(error)).not.toContain(jwt);
  });
});

describe('Supabase JWKS (createSupabaseJwks)', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let fetches = 0;
  let status = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url !== '/auth/v1/.well-known/jwks.json') {
        res.writeHead(404).end();
        return;
      }
      fetches++;
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches the keys from {SUPABASE_URL}/auth/v1/.well-known/jwks.json and caches them', async () => {
    fetches = 0;
    const cached = new SupabaseJwtVerifier(createSupabaseJwks({ SUPABASE_URL: baseUrl }), ISSUER);
    for (let i = 0; i < 5; i++) {
      await expect(cached.verify(await token())).resolves.toMatchObject({ userId: USER_ID });
    }
    expect(fetches).toBe(1);
  });

  it('does not refetch for every unknown key ID (cooldown)', async () => {
    fetches = 0;
    const cached = new SupabaseJwtVerifier(createSupabaseJwks({ SUPABASE_URL: baseUrl }), ISSUER);
    await cached.verify(await token());
    for (let i = 0; i < 5; i++) {
      expect(await rejection(cached.verify(await token({ kid: `unknown-${i}` })))).toBeInstanceOf(
        InvalidTokenError,
      );
    }
    expect(fetches).toBe(1);
  });

  it('treats an error from the key endpoint as "keys unavailable", not as a bad token', async () => {
    status = 500;
    try {
      const failing = new SupabaseJwtVerifier(
        createSupabaseJwks({ SUPABASE_URL: baseUrl }),
        ISSUER,
      );
      expect(await rejection(failing.verify(await token()))).toBeInstanceOf(
        SigningKeysUnavailableError,
      );
    } finally {
      status = 200;
    }
  });
});
