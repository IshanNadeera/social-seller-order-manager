// HTTP tests for the global AuthGuard (docs/DEVELOPMENT.md §9, §11.1, §11.2, §12.4): token
// verification, then account and membership. Signing keys are local test keys, and the account
// lookup is replaced by a fake (test/account.db-spec.ts tests the real query).
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AccountService } from '../src/auth/account.service';
import type { AccountState } from '../src/auth/account.service';
import { CurrentAuth, CurrentUser } from '../src/auth/auth-context';
import type { AuthContext } from '../src/auth/auth-context';
import { JWKS } from '../src/auth/auth.module';
import type { VerifiedUser } from '../src/auth/jwt-verifier';
import { AllowWithoutMembership } from '../src/auth/membership-optional.decorator';
import { PrismaService } from '../src/common/prisma.service';
import { fakePrisma } from './fake-prisma';
import { testEnv } from './test-env';

const KID = 'test-key-1';
const BUSINESS_ID = '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
const USERS = {
  member: '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b',
  newcomer: '1c8dab63-4021-4dab-8a3c-6e7f8091a2b3',
  disabled: '2d9ebc74-5132-4ebc-9b4d-7f8091a2b3c4',
} as const;

/** Fake account lookup keyed by user ID. */
class FakeAccountService {
  load(userId: string): Promise<AccountState> {
    if (userId === USERS.member) {
      return Promise.resolve({ status: 'member', businessId: BUSINESS_ID, role: 'OWNER' });
    }
    if (userId === USERS.disabled) return Promise.resolve({ status: 'disabled' });
    return Promise.resolve({ status: 'no-membership' });
  }
}

/** Test-only routes: a normal one and a membership-optional one (like /me and /onboarding). */
@Controller('test')
class ProbeController {
  @Get('scoped')
  scoped(@CurrentAuth() auth: AuthContext): AuthContext {
    return auth;
  }

  @AllowWithoutMembership()
  @Get('optional')
  optional(@CurrentUser() user: VerifiedUser): { userId: string } {
    return { userId: user.userId };
  }
}

async function startApp(keys: JWTVerifyGetKey): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv)],
    controllers: [ProbeController],
  })
    .overrideProvider(JWKS)
    .useValue(keys)
    .overrideProvider(AccountService)
    .useValue(new FakeAccountService())
    .overrideProvider(PrismaService)
    .useValue(fakePrisma())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, testEnv);
  await app.init();
  return app;
}

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

function sign(key: SigningKey, userId: string): Promise<string> {
  return new SignJWT({ email: 'seller@example.test', role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(testEnv.SUPABASE_JWT_ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

describe('AuthGuard over HTTP', () => {
  let app: NestExpressApplication;
  let server: App;
  const tokens: Record<keyof typeof USERS | 'foreign', string> = {
    member: '',
    newcomer: '',
    disabled: '',
    foreign: '',
  };

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    const stranger = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256' };
    app = await startApp(createLocalJWKSet({ keys: [jwk] }));
    server = app.getHttpServer();
    tokens.member = await sign(pair.privateKey, USERS.member);
    tokens.newcomer = await sign(pair.privateKey, USERS.newcomer);
    tokens.disabled = await sign(pair.privateKey, USERS.disabled);
    tokens.foreign = await sign(stranger.privateKey, USERS.member);
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(server).get(`/api/v1/${path}`);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };

  describe('token (A13)', () => {
    it('lets anyone reach the public health check', async () => {
      await get('health').expect(200, { status: 'ok', database: 'ok' });
    });

    it('rejects a protected route without a token', async () => {
      await get('test/scoped').expect(401);
      await get('test/optional').expect(401);
    });

    it.each([
      ['a non-Bearer scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
      ['an empty Bearer token', 'Bearer '],
      ['a token in the wrong format', 'Bearer not a token'],
    ])('rejects %s', async (_label, header) => {
      await request(server).get('/api/v1/test/scoped').set('Authorization', header).expect(401);
    });

    it('rejects a token signed by someone else, without echoing it', async () => {
      const res = await get('test/scoped', tokens.foreign).expect(401);
      expect(res.text).not.toContain(tokens.foreign);
    });

    it('accepts the scheme name in any case', async () => {
      await request(server)
        .get('/api/v1/test/scoped')
        .set('Authorization', `bearer ${tokens.member}`)
        .expect(200);
    });

    it('answers 404 for routes that do not exist (no route, so nothing to guard)', async () => {
      await get('no-such-route').expect(404);
    });
  });

  describe('membership (A14)', () => {
    it('sets req.auth = { userId, businessId, role } for a member', async () => {
      await get('test/scoped', tokens.member).expect(200, {
        userId: USERS.member,
        businessId: BUSINESS_ID,
        role: 'OWNER',
      });
    });

    it('refuses a user without a business on normal routes, with a code the web app can act on', async () => {
      const res = await get('test/scoped', tokens.newcomer).expect(403);
      expect(res.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    });

    it('lets a user without a business reach membership-optional routes (/me, /onboarding)', async () => {
      await get('test/optional', tokens.newcomer).expect(200, { userId: USERS.newcomer });
    });

    it('lets a member reach membership-optional routes too', async () => {
      await get('test/optional', tokens.member).expect(200, { userId: USERS.member });
    });

    it.each(['test/scoped', 'test/optional'])('refuses a disabled account on %s', async (path) => {
      const res = await get(path, tokens.disabled).expect(403);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    });
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
    const jwt = await sign(pair.privateKey, USERS.member);
    await request(app.getHttpServer())
      .get('/api/v1/test/scoped')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(503);
  });
});
