// HTTP tests for the global AuthGuard (docs/DEVELOPMENT.md §9, §11.2, §12.4): every route except
// @Public() ones needs a valid Supabase access token. Signing keys are local test keys.
import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { AuthenticatedRequest } from '../src/auth/auth.guard';
import { JWKS } from '../src/auth/auth.module';
import type { VerifiedUser } from '../src/auth/jwt-verifier';
import { testEnv } from './test-env';

const USER_ID = '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b';
const KID = 'test-key-1';

/** Test-only protected route that echoes the verified user. */
@Controller('test-me')
class MeController {
  @Get()
  me(@Req() req: AuthenticatedRequest): VerifiedUser {
    return req.user;
  }
}

async function startApp(keys: JWTVerifyGetKey): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv)],
    controllers: [MeController],
  })
    .overrideProvider(JWKS)
    .useValue(keys)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, testEnv);
  await app.init();
  return app;
}

describe('AuthGuard over HTTP', () => {
  let app: NestExpressApplication;
  let server: App;
  let validToken: string;
  let foreignToken: string;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    const stranger = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256' };
    app = await startApp(createLocalJWKSet({ keys: [jwk] }));
    server = app.getHttpServer();

    const sign = (key: typeof pair.privateKey) =>
      new SignJWT({ email: 'seller@example.test', role: 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid: KID })
        .setSubject(USER_ID)
        .setIssuer(testEnv.SUPABASE_JWT_ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(key);
    validToken = await sign(pair.privateKey);
    foreignToken = await sign(stranger.privateKey);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets anyone reach the public health check', async () => {
    await request(server).get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('rejects a protected route without a token', async () => {
    await request(server).get('/api/v1/test-me').expect(401);
  });

  it.each([
    ['a non-Bearer scheme', () => `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['an empty Bearer token', () => 'Bearer '],
    ['a token in the wrong format', () => 'Bearer not a token'],
  ])('rejects %s', async (_label, header) => {
    await request(server).get('/api/v1/test-me').set('Authorization', header()).expect(401);
  });

  it('rejects a token signed by someone else', async () => {
    const res = await request(server)
      .get('/api/v1/test-me')
      .set('Authorization', `Bearer ${foreignToken}`)
      .expect(401);
    expect(res.text).not.toContain(foreignToken);
  });

  it('accepts a valid token and exposes the verified user to the route', async () => {
    await request(server)
      .get('/api/v1/test-me')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200, { userId: USER_ID, email: 'seller@example.test', sessionId: null });
  });

  it('accepts the scheme name in any case', async () => {
    await request(server)
      .get('/api/v1/test-me')
      .set('Authorization', `bearer ${validToken}`)
      .expect(200);
  });

  it('answers 404 for routes that do not exist (no route, so nothing to guard)', async () => {
    await request(server).get('/api/v1/no-such-route').expect(404);
  });
});

describe('AuthGuard when Supabase signing keys are unreachable', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await startApp(() => Promise.reject(new TypeError('fetch failed')));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 503 instead of logging the user out with a 401', async () => {
    const pair = await generateKeyPair('ES256');
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(USER_ID)
      .setIssuer(testEnv.SUPABASE_JWT_ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(pair.privateKey);
    await request(app.getHttpServer())
      .get('/api/v1/test-me')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(503);
  });
});
