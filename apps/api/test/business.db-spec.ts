// GET and PATCH /business against the real database (docs/DEVELOPMENT.md §6.8, §9.1, task E5):
// each business reads and changes only its own profile, only the owner may change it, and a new
// order prefix applies to new orders while the counter carries on.
// Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { BusinessView, OrderDetail } from '@ssom/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { createTestAuth } from './test-auth';
import { createTwoTenants } from './tenant-isolation';
import type { Tenant, TwoTenants } from './tenant-isolation';

const B_PATH = '/api/v1/business';

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let staff: Tenant;

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });
const read = async (tenant: Tenant) =>
  (await request(server).get(B_PATH).set(as(tenant)).expect(200)).body as BusinessView;
const patch = (tenant: Tenant, body: object) =>
  request(server).patch(B_PATH).set(as(tenant)).send(body);

/** A cash pickup for a walk-in, which needs no customer. */
const newOrder = async (tenant: Tenant) =>
  (
    await request(server)
      .post('/api/v1/orders')
      .set(as(tenant))
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceChannel: 'WALK_IN',
        fulfilmentType: 'PICKUP',
        items: [{ name: 'Scarf', quantity: 1, unitPrice: '500' }],
        paymentMethod: 'CASH',
      })
      .expect(201)
  ).body as OrderDetail;

beforeAll(async () => {
  const env = parseEnv(process.env);
  const testAuth = await createTestAuth(env.SUPABASE_JWT_ISSUER);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(JWKS)
    .useValue(testAuth.jwks)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, env);
  await app.init();
  server = app.getHttpServer();
  prisma = moduleRef.get(PrismaService);
  tenants = await createTwoTenants(prisma, testAuth);

  // A STAFF member of business A: may read the profile, not change it.
  const staffId = randomUUID();
  const email = `staff-${staffId}@example.test`;
  await prisma.user.create({ data: { id: staffId, email } });
  await prisma.businessMember.create({
    data: { businessId: tenants.a.businessId, userId: staffId, role: 'STAFF' },
  });
  staff = { ...tenants.a, userId: staffId, email, token: await testAuth.sign(staffId, email) };
});

afterAll(async () => {
  await prisma.businessMember.deleteMany({ where: { userId: staff.userId } });
  await tenants.cleanup();
  await prisma.user.deleteMany({ where: { id: staff.userId } });
  await app.close();
});

describe('GET /business (§9.1)', () => {
  it('returns the caller’s own business, with the next order number’s sequence', async () => {
    const res = await request(server).get(B_PATH).set(as(tenants.a)).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const business = res.body as BusinessView;
    expect(business).toMatchObject({ id: tenants.a.businessId, currency: 'LKR' });
    const before = business.nextOrderSequence;
    await newOrder(tenants.a);
    expect((await read(tenants.a)).nextOrderSequence).toBe(before + 1);
    expect((await read(tenants.b)).id).toBe(tenants.b.businessId);
  });
});

describe('PATCH /business (§6.8)', () => {
  it('changes only the fields sent, tidied like onboarding', async () => {
    const before = await read(tenants.a);
    const res = await patch(tenants.a, {
      name: '  Nimali Fashions  ',
      contactPhone: '077 123 4567',
      defaultDeliveryFee: '350',
      timezone: 'Asia/Kolkata',
    }).expect(200);
    expect(res.body).toEqual({
      ...before,
      name: 'Nimali Fashions',
      contactPhone: '077 123 4567',
      defaultDeliveryFee: '350.00',
      timezone: 'Asia/Kolkata',
    });
    // An empty phone removes it; nothing else moves.
    const cleared = (await patch(tenants.a, { contactPhone: '' }).expect(200)).body as BusinessView;
    expect(cleared).toEqual({ ...(res.body as BusinessView), contactPhone: null });
    // /me, which the app reads everywhere, has the new values too.
    const me = await request(server).get('/api/v1/me').set(as(tenants.a)).expect(200);
    expect(me.body).toMatchObject({
      business: { name: 'Nimali Fashions', timezone: 'Asia/Kolkata', defaultDeliveryFee: '350.00' },
    });
  });

  it('a new prefix is used for new orders; the counter carries on, so numbers never repeat', async () => {
    const earlier = await newOrder(tenants.a);
    await patch(tenants.a, { orderPrefix: 'abc1' }).expect(200);
    const later = await newOrder(tenants.a);
    const earlierSeq = Number(earlier.orderNumber.split('-')[1]);
    expect(later.orderNumber).toBe(`ABC1-${String(earlierSeq + 1).padStart(4, '0')}`);
    // The earlier order keeps its number.
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: earlier.id } });
    expect(kept.orderNumber).toBe(earlier.orderNumber);
  });

  it('changes only the caller’s business', async () => {
    const theirs = await read(tenants.b);
    await patch(tenants.a, { name: 'Only Mine' }).expect(200);
    expect(await read(tenants.b)).toEqual(theirs);
  });

  it.each([
    [{}, ''],
    [{ name: '   ' }, 'name'],
    [{ orderPrefix: 'N!' }, 'orderPrefix'],
    [{ orderPrefix: 'TOOLONG7' }, 'orderPrefix'],
    [{ defaultDeliveryFee: '-1' }, 'defaultDeliveryFee'],
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
    [{ currency: 'USD' }, 'currency'],
    [{ name: 'Moved', businessId: randomUUID() }, 'businessId'],
  ] as const)('refuses %o (400 on %s) and changes nothing', async (body, field) => {
    const before = await read(tenants.a);
    const res = await patch(tenants.a, body).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    if (field !== '')
      expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
    expect(await read(tenants.a)).toEqual(before);
  });

  it('staff may read the profile but not change it (403)', async () => {
    const before = await read(staff);
    const res = await patch(staff, { name: 'Staff Was Here' }).expect(403);
    expect(res.body).toMatchObject({ code: 'OWNER_ONLY' });
    expect(await read(tenants.a)).toEqual(before);
  });
});
