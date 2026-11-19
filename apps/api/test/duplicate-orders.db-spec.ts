// GET /orders/possible-duplicates against the real database (docs/DEVELOPMENT.md §2.2, task E6):
// same customer phone, similar total (within 10%), made in the last 30 minutes, not cancelled. It
// only ever warns: the same order can still be saved. Run with: npm run test:db -w apps/api.
// Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail, PossibleDuplicate } from '@ssom/shared';
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
import type { TwoTenants } from './tenant-isolation';

const O = '/api/v1/orders';
const PHONE = { phoneNormalized: '+94771234567', phoneDisplay: '077 123 4567' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
/** Business A's customers: two records with one phone, one without a phone, one other phone. */
const customer: Record<'first' | 'twin' | 'noPhone' | 'other', string> = {
  first: '',
  twin: '',
  noPhone: '',
  other: '',
};
const order: Record<string, OrderDetail> = {};

const auth = () => ({ Authorization: `Bearer ${tenants.a.token}` });

/** A cash pickup of `total` for `customerId`. */
const create = async (customerId: string, total: string) =>
  (
    await request(server)
      .post(O)
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceChannel: 'WHATSAPP',
        fulfilmentType: 'PICKUP',
        customerId,
        items: [{ name: 'Silk Saree', quantity: 1, unitPrice: total }],
        paymentMethod: 'CASH',
      })
      .expect(201)
  ).body as OrderDetail;

const check = (customerId: string, total: string) =>
  request(server).get(`${O}/possible-duplicates`).query({ customerId, total }).set(auth());
const matches = async (customerId: string, total: string) =>
  ((await check(customerId, total).expect(200)).body as PossibleDuplicate[]).map(
    (found) => found.orderNumber,
  );

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

  const businessId = tenants.a.businessId;
  const make = async (name: string, phone: object) =>
    (await prisma.customer.create({ data: { businessId, name, ...phone } })).id;
  customer.first = await make('Kamala Perera', PHONE);
  customer.twin = await make('Kamala P.', PHONE); // the same person, entered twice
  customer.noPhone = await make('No Phone', {});
  customer.other = await make('Someone Else', {
    phoneNormalized: '+94779999999',
    phoneDisplay: '077 999 9999',
  });

  order.first = await create(customer.first, '2450');
  order.twin = await create(customer.twin, '2300'); // 6% less: similar
  order.bigger = await create(customer.first, '5000'); // not similar
  order.cancelled = await create(customer.first, '2450');
  await request(server)
    .post(`${O}/${order.cancelled.id}/cancel`)
    .set(auth())
    .send({ reason: 'Entered twice' })
    .expect(200);
  order.other = await create(customer.other, '2450'); // another phone
  order.old = await create(customer.first, '2450');
  await prisma.order.update({
    where: { id: order.old.id },
    data: { createdAt: new Date(Date.now() - 31 * 60_000) }, // just outside 30 minutes
  });
  order.noPhone = await create(customer.noPhone, '2450');
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /orders/possible-duplicates (§2.2)', () => {
  it('lists recent orders for the same phone with a similar total, newest first', async () => {
    const res = await check(customer.first, '2450.00').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const found = res.body as PossibleDuplicate[];
    // The twin record shares the phone; bigger, cancelled, other-phone and old orders don't count.
    expect(found.map((item) => item.orderNumber)).toEqual([
      order.twin.orderNumber,
      order.first.orderNumber,
    ]);
    expect(found[1]).toEqual({
      id: order.first.id,
      orderNumber: order.first.orderNumber,
      createdAt: order.first.createdAt,
      totalAmount: '2450.00',
      stage: 'NEW',
    });
  });

  it('the same phone works from either customer record', async () => {
    expect(await matches(customer.twin, '2400')).toEqual([
      order.twin.orderNumber,
      order.first.orderNumber,
    ]);
  });

  it('“similar” is within 10% of the larger total', async () => {
    expect(await matches(customer.first, '4600')).toEqual([order.bigger.orderNumber]); // 8% off
    expect(await matches(customer.first, '4000')).toEqual([]); // 20% off
  });

  it('a customer without a phone matches only their own orders', async () => {
    expect(await matches(customer.noPhone, '2450')).toEqual([order.noPhone.orderNumber]);
  });

  it('is only a warning: the same order can still be saved', async () => {
    expect(await matches(customer.other, '2450')).toEqual([order.other.orderNumber]);
    const again = await create(customer.other, '2450');
    expect(await matches(customer.other, '2450')).toEqual([
      again.orderNumber,
      order.other.orderNumber,
    ]);
  });

  it.each([
    [{ total: '2450' }, 'customerId'],
    [{ customerId: 'not-a-uuid', total: '2450' }, 'customerId'],
    [{ customerId: randomUUID() }, 'total'],
    [{ customerId: randomUUID(), total: '-1' }, 'total'],
    [{ customerId: randomUUID(), total: '1', businessId: randomUUID() }, 'businessId'],
  ] as const)('refuses %o (400 on %s)', async (query, field) => {
    const res = await request(server)
      .get(`${O}/possible-duplicates`)
      .query(query)
      .set(auth())
      .expect(400);
    expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
  });

  it('an unknown customer is not found', async () => {
    await check(randomUUID(), '2450').expect(404);
  });
});
