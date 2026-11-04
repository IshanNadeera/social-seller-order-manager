// POST /onboarding against the real database, through the real AuthGuard
// (docs/DEVELOPMENT.md §7.12, §9.1, ADR-010). Signing keys are local test keys.
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
import { PrismaService } from '../src/common/prisma.service';

const KID = 'test-key-1';

describe('POST /onboarding', () => {
  let app: NestExpressApplication;
  let server: App;
  let prisma: PrismaService;
  let sign: (userId: string, email: string) => Promise<string>;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    const env = parseEnv(process.env);
    const pair = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256' };
    sign = (userId, email) =>
      new SignJWT({ email })
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
  });

  afterAll(async () => {
    const memberships = await prisma.businessMember.findMany({
      where: { userId: { in: createdUsers } },
      select: { businessId: true },
    });
    const businessIds = memberships.map((m) => m.businessId);
    await prisma.businessMember.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessCounter.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await app.close();
  });

  /** A new signed-up user (no app.users row yet). */
  function newUser() {
    const id = randomUUID();
    createdUsers.push(id);
    return { id, email: `onboarding-${id}@example.test` };
  }

  async function onboard(user: { id: string; email: string }, body: unknown) {
    return request(server)
      .post('/api/v1/onboarding')
      .set('Authorization', `Bearer ${await sign(user.id, user.email)}`)
      .send(body as object);
  }

  async function rowsFor(userId: string) {
    const memberships = await prisma.businessMember.findMany({ where: { userId } });
    const businessIds = memberships.map((m) => m.businessId);
    return {
      user: await prisma.user.findUnique({ where: { id: userId } }),
      memberships,
      businesses: await prisma.business.findMany({ where: { id: { in: businessIds } } }),
      counters: await prisma.businessCounter.findMany({
        where: { businessId: { in: businessIds } },
      }),
    };
  }

  it('requires a token', async () => {
    await request(server).post('/api/v1/onboarding').send({ businessName: 'X' }).expect(401);
  });

  it('creates the users row, business, counter and OWNER membership, and answers like /me', async () => {
    const user = newUser();
    const res = await onboard(user, {
      businessName: 'Nimali Fashions',
      contactPhone: '077 000 0001',
    });
    expect(res.status).toBe(201);

    const rows = await rowsFor(user.id);
    expect(rows.user?.email).toBe(user.email);
    expect(rows.memberships).toHaveLength(1);
    expect(rows.memberships[0]?.role).toBe('OWNER');
    expect(rows.businesses).toHaveLength(1);
    const business = rows.businesses[0];
    expect(business).toMatchObject({
      name: 'Nimali Fashions',
      contactPhone: '077 000 0001',
      orderPrefix: 'NIM', // suggested from the name (§7.12)
      currency: 'LKR',
      timezone: 'Asia/Colombo',
    });
    expect(rows.counters).toEqual([{ businessId: business?.id, nextOrderSeq: 1 }]);

    expect(res.body as MeResponse).toEqual({
      user: { id: user.id, email: user.email },
      needsOnboarding: false,
      role: 'OWNER',
      business: {
        id: business?.id,
        name: 'Nimali Fashions',
        orderPrefix: 'NIM',
        currency: 'LKR',
        timezone: 'Asia/Colombo',
        defaultDeliveryFee: '0.00',
      },
    });

    const me = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${await sign(user.id, user.email)}`);
    expect((me.body as MeResponse).needsOnboarding).toBe(false);
  });

  it('is idempotent: a repeat returns the same business (200) and creates nothing', async () => {
    const user = newUser();
    const first = await onboard(user, { businessName: 'Kasun Stores' });
    const second = await onboard(user, { businessName: 'A different name', orderPrefix: 'XYZ' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as MeResponse).business).toEqual((first.body as MeResponse).business);

    const rows = await rowsFor(user.id);
    expect(rows.businesses).toHaveLength(1);
    expect(rows.businesses[0]?.name).toBe('Kasun Stores');
    expect(rows.counters).toHaveLength(1);
  });

  it('creates exactly one business when the same user sends five requests at once', async () => {
    const user = newUser();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => onboard(user, { businessName: 'Parallel Shop' })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const rows = await rowsFor(user.id);
    expect(rows.businesses).toHaveLength(1);
    expect(rows.memberships).toHaveLength(1);
    expect(rows.counters).toHaveLength(1);
  });

  it('uses the prefix the seller typed, uppercased', async () => {
    const user = newUser();
    await onboard(user, { businessName: 'Anything', orderPrefix: ' gift ' }).then((r) =>
      expect(r.status).toBe(201),
    );
    expect((await rowsFor(user.id)).businesses[0]?.orderPrefix).toBe('GIFT');
  });

  it('defaults the prefix to ORD when the name gives nothing to suggest', async () => {
    const user = newUser();
    await onboard(user, { businessName: 'නිමාලි ෆැෂන්' }).then((r) => expect(r.status).toBe(201));
    expect((await rowsFor(user.id)).businesses[0]?.orderPrefix).toBe('ORD');
  });

  it.each([
    [{ businessName: '' }, 'businessName'],
    [{ businessName: 'Shop', orderPrefix: 'N!' }, 'orderPrefix'],
    [{ businessName: 'Shop', businessId: randomUUID() }, 'businessId'],
  ])('refuses %j with a field error and creates nothing', async (body, field) => {
    const user = newUser();
    const res = await onboard(user, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
    expect((await rowsFor(user.id)).user).toBeNull();
  });

  it('rolls everything back when the email belongs to another account (409)', async () => {
    const owner = newUser();
    await onboard(owner, { businessName: 'First Owner' }).then((r) => expect(r.status).toBe(201));
    const intruder = newUser();
    const res = await onboard({ id: intruder.id, email: owner.email }, { businessName: 'Second' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'EMAIL_IN_USE' });
    const rows = await rowsFor(intruder.id);
    expect(rows.user).toBeNull();
    expect(rows.businesses).toHaveLength(0);
  });
});
