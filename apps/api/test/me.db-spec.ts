// GET /me and GET /health against the real database, through the real AuthGuard
// (docs/DEVELOPMENT.md §8.2, §9.1, §11.7). Signing keys are local test keys.
// Needs a migrated local database. Run with: npm run test:db -w apps/api
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { MeResponse } from '@ssom/shared';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import type { Env } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';

const KID = 'test-key-1';

describe('GET /me and GET /health with the database', () => {
  let env: Env;
  let app: NestExpressApplication;
  let server: App;
  let prisma: PrismaService;
  let token: (userId: string, email: string | null) => Promise<string>;

  const user = {
    member: randomUUID(),
    newcomer: randomUUID(), // signed up, not onboarded: no app.users row
    disabled: randomUUID(),
    renamed: randomUUID(),
  };
  const businessId = randomUUID();
  const userIds = Object.values(user);

  beforeAll(async () => {
    env = parseEnv(process.env);
    const pair = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256' };
    token = (userId, email) =>
      new SignJWT(email === null ? {} : { email })
        .setProtectedHeader({ alg: 'ES256', kid: KID })
        .setSubject(userId)
        .setIssuer(env.SUPABASE_JWT_ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(pair.privateKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(JWKS)
      .useValue(createLocalJWKSet({ keys: [jwk] }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app, env);
    await app.init();
    server = app.getHttpServer();
    prisma = moduleRef.get(PrismaService);

    await prisma.user.createMany({
      data: [
        { id: user.member, email: `me-member-${user.member}@example.test` },
        {
          id: user.disabled,
          email: `me-disabled-${user.disabled}@example.test`,
          disabledAt: new Date(),
        },
        { id: user.renamed, email: `me-old-${user.renamed}@example.test` },
      ],
    });
    await prisma.business.create({
      data: { id: businessId, name: 'Me test business', orderPrefix: 'MET' },
    });
    await prisma.businessMember.create({
      data: { businessId, userId: user.member, role: 'OWNER' },
    });
  });

  afterAll(async () => {
    await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const me = async (userId: string, email: string | null) =>
    request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${await token(userId, email)}`);

  it('requires a token', async () => {
    await request(server).get('/api/v1/me').expect(401);
  });

  it('returns needsOnboarding: true for a signed-up user without a business', async () => {
    const res = await me(user.newcomer, 'New.Seller@Example.test');
    expect(res.status).toBe(200);
    expect(res.body as MeResponse).toEqual({
      user: { id: user.newcomer, email: 'new.seller@example.test' },
      needsOnboarding: true,
      role: null,
      business: null,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns the business summary and role for a member', async () => {
    const res = await me(user.member, `me-member-${user.member}@example.test`);
    expect(res.status).toBe(200);
    expect(res.body as MeResponse).toEqual({
      user: { id: user.member, email: `me-member-${user.member}@example.test` },
      needsOnboarding: false,
      role: 'OWNER',
      business: {
        id: businessId,
        name: 'Me test business',
        orderPrefix: 'MET',
        currency: 'LKR',
        timezone: 'Asia/Colombo',
        defaultDeliveryFee: '0.00',
      },
    });
  });

  it('refuses a disabled account', async () => {
    const res = await me(user.disabled, `me-disabled-${user.disabled}@example.test`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('syncs an email changed in Supabase Auth into app.users (§8.2)', async () => {
    const newEmail = `me-new-${user.renamed}@example.test`;
    expect((await me(user.renamed, newEmail)).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.renamed } });
    expect(row.email).toBe(newEmail);
  });

  it('keeps serving /me when the new email belongs to another account', async () => {
    const taken = `me-member-${user.member}@example.test`;
    expect((await me(user.renamed, taken)).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.renamed } });
    expect(row.email).not.toBe(taken);
  });

  it('does not create an app.users row (onboarding does that)', async () => {
    expect((await me(user.newcomer, 'x@example.test')).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.newcomer } })).toBeNull();
  });

  it('GET /health pings the real database', async () => {
    await request(server).get('/api/v1/health').expect(200, { status: 'ok', database: 'ok' });
  });
});
