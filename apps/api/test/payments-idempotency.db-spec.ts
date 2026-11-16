// Idempotency on the money routes, against the real database (docs/DEVELOPMENT.md §9.8, §12.2,
// ADR-007, task D9): a replayed or simultaneous request with the same Idempotency-Key records the
// money once; a key can't be reused for different money; a refused request leaves its key free.
// The general rules are tested on a stand-in route in idempotency.db-spec.ts; this file checks them
// where money is at stake. Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail, PaymentRecorded } from '@ssom/shared';
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

const API = '/api/v1';
const O = `${API}/orders`;
const ADDRESS = { recipientName: 'Key Demo', phone: '0771234567', addressLine1: '1 Key Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;

const auth = () => ({ Authorization: `Bearer ${tenants.a.token}` });
const post = (path: string, body: object, key?: string) => {
  const req = request(server).post(path).set(auth());
  return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
};

/** A cash pickup of 1000.00, nothing paid. */
async function cashOrder(): Promise<OrderDetail> {
  const res = await post(
    O,
    {
      sourceChannel: 'WHATSAPP',
      fulfilmentType: 'PICKUP',
      customerId,
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
      paymentMethod: 'CASH',
    },
    randomUUID(),
  ).expect(201);
  return res.body as OrderDetail;
}

/** A COD delivery of 1000.00 + 350.00, delivered: the courier holds 1350.00 (COLLECTED). */
async function collectedOrder(): Promise<OrderDetail> {
  const order = (
    await post(
      O,
      {
        sourceChannel: 'WHATSAPP',
        customerId,
        items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
        deliveryFee: '350',
        paymentMethod: 'COD',
        delivery: ADDRESS,
      },
      randomUUID(),
    ).expect(201)
  ).body as OrderDetail;
  for (const [path, body] of [
    ['/status', { to: 'CONFIRMED' }],
    ['/status', { to: 'READY' }],
    ['/delivery/dispatch', { courierName: 'Domex' }],
    ['/delivery/delivered', {}],
  ] as const) {
    await post(`${O}/${order.id}${path}`, body).expect(200);
  }
  return order;
}

const pay = (orderId: string, amount: string, key: string) =>
  post(`${O}/${orderId}/payments`, { type: 'PAYMENT', method: 'CASH', amount }, key);

const payments = (orderId: string) =>
  prisma.payment.findMany({ where: { businessId: tenants.a.businessId, orderId } });
const amountPaid = async (orderId: string) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).amountPaid.toFixed(2);

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
  customerId = (
    await prisma.customer.create({ data: { businessId: tenants.a.businessId, name: 'Key Demo' } })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('POST /orders/:id/payments (§9.8)', () => {
  it('replaying a key records one payment, even after the order has changed since', async () => {
    const order = await cashOrder();
    const key = randomUUID();
    const first = await pay(order.id, '400', key).expect(201);
    // Another payment in between: the replay still answers with what the first request did.
    await pay(order.id, '100', randomUUID()).expect(201);
    const again = await pay(order.id, '400', key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect((first.body as PaymentRecorded).order.amountPaid).toBe('400.00');
    expect(await payments(order.id)).toHaveLength(2);
    expect(await amountPaid(order.id)).toBe('500.00');
  });

  it('two requests with the same key at the same moment record one payment, and both get it', async () => {
    const order = await cashOrder();
    const key = randomUUID();
    const [one, two] = await Promise.all([pay(order.id, '600', key), pay(order.id, '600', key)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body).toEqual(two.body);
    expect(await payments(order.id)).toHaveLength(1);
    expect(await amountPaid(order.id)).toBe('600.00');
  });

  it('a key used for different money, or for another order, is refused (409) and records nothing', async () => {
    const order = await cashOrder();
    const other = await cashOrder();
    const key = randomUUID();
    await pay(order.id, '300', key).expect(201);
    const changed = await pay(order.id, '350', key).expect(409);
    expect(changed.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await pay(other.id, '300', key).expect(409);
    expect(await payments(order.id)).toHaveLength(1);
    expect(await payments(other.id)).toHaveLength(0);
  });

  it('a refused payment keeps nothing, so the same key works for the corrected one', async () => {
    const order = await cashOrder();
    const key = randomUUID();
    const refused = await pay(order.id, '5000', key).expect(422);
    expect(refused.body).toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
    const ok = await pay(order.id, '1000', key).expect(201);
    expect(ok.headers['idempotent-replayed']).toBeUndefined();
    expect(await payments(order.id)).toHaveLength(1);
  });

  it('without a key nothing is recorded', async () => {
    const order = await cashOrder();
    await post(`${O}/${order.id}/payments`, {
      type: 'PAYMENT',
      method: 'CASH',
      amount: '100',
    }).expect(400);
    expect(await payments(order.id)).toHaveLength(0);
  });
});

describe('settling COD (§7.8)', () => {
  const settle = (orderId: string, key: string) => post(`${O}/${orderId}/cod/settle`, {}, key);
  const codPayments = async (orderIds: string[]) =>
    prisma.payment.findMany({ where: { orderId: { in: orderIds }, method: 'COD' } });

  it('the same key at the same moment: one COD payment, the same answer twice', async () => {
    const order = await collectedOrder();
    const key = randomUUID();
    const [one, two] = await Promise.all([settle(order.id, key), settle(order.id, key)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body).toEqual(two.body);
    expect(await codPayments([order.id])).toHaveLength(1);
  });

  it('two different keys at the same moment: one settles, the other is refused', async () => {
    const order = await collectedOrder();
    const results = await Promise.all([
      settle(order.id, randomUUID()),
      settle(order.id, randomUUID()),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);
    const refused = results.find((res) => res.status === 422);
    expect(refused?.body).toMatchObject({ code: 'COD_NOT_COLLECTED' });
    expect(await codPayments([order.id])).toHaveLength(1);
  });

  it('bulk: replaying a remittance, even at the same moment, records each order’s COD once', async () => {
    const first = await collectedOrder();
    const second = await collectedOrder();
    const key = randomUUID();
    const body = { orderIds: [first.id, second.id], reference: 'Domex remit 9' };
    const [one, two] = await Promise.all([
      post(`${API}/cod/settle`, body, key),
      post(`${API}/cod/settle`, body, key),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body).toEqual(two.body);
    const replay = await post(`${API}/cod/settle`, body, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await codPayments([first.id, second.id])).toHaveLength(2);
  });
});
