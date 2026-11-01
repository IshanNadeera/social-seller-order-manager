// Local signing keys for tests: a key set to put in place of Supabase's JWKS, and a signer that
// issues Supabase-shaped access tokens for it. Use with .overrideProvider(JWKS).useValue(auth.jwks).
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export interface TestAuth {
  jwks: JWTVerifyGetKey;
  sign(userId: string, email: string | null): Promise<string>;
}

export async function createTestAuth(issuer: string): Promise<TestAuth> {
  const kid = 'test-key-1';
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    sign: (userId, email) =>
      new SignJWT(email === null ? {} : { email })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(pair.privateKey),
  };
}
