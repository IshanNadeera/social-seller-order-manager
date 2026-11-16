// Bulk COD settle and the list of COD awaiting settlement, against the real database
// (docs/DEVELOPMENT.md §9.4, §2.2, §7.8, task D8): one courier remittance settles every chosen
// order or none. Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { CodAwaitingItem, CodBulkSettled, OrderDetail, Page } from '@ssom/shared';
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

const API = '/api/v1';
const ADDRESS = { recipientName: 'Bulk Demo', phone: '0771234567', addressLine1: '1 Bulk Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
const customers = new Map<Tenant, string>();

const auth = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });
const post = (path: string, body: object, tenant: Tenant = tenants.a) =>
  request(server).post(`${API}${path}`).set(auth(tenant)).send(body);

/** A COD order of `amount` + 350.00 delivery, nothing paid: COD is the whole total. */
async function codOrder(amount: string, tenant: Tenant = tenants.a): Promise<OrderDetail> {
  const res = await post(
    '/orders',
    {
      sourceChannel: 'WHATSAPP',
      customerId: customers.get(tenant),
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: amount }],
      deliveryFee: '350',
      paymentMethod: 'COD',
      delivery: ADDRESS,
    },
    tenant,
  )
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  return res.body as OrderDetail;
}

/** NEW → delivered by `courier`: the courier holds the COD (COLLECTED). */
async function collected(amount: string, courier: string, tenant: Tenant = tenants.a) {
  const order = await codOrder(amount, tenant);
  const path = `/orders/${order.id}`;
  await post(`${path}/status`, { to: 'CONFIRMED' }, tenant).expect(200);
  await post(`${path}/status`, { to: 'READY' }, tenant).expect(200);
  await post(`${path}/delivery/dispatch`, { courierName: courier }, tenant).expect(200);
  await post(`${path}/delivery/delivered`, {}, tenant).expect(200);
  return order;
}

const settle = (body: object, key: string = randomUUID(), tenant: Tenant = tenants.a) =>
  post('/cod/settle', body, tenant).set('Idempotency-Key', key);

const awaiting = async (tenant: Tenant = tenants.a) =>
  (await request(server).get(`${API}/cod/awaiting?pageSize=100`).set(auth(tenant)).expect(200))
    .body as Page<CodAwaitingItem>;

const codStatus = async (orderId: string) =>
  (await prisma.delivery.findUniqueOrThrow({ where: { orderId } })).codStatus;
const codPayments = (orderIds: string[]) =>
  prisma.payment.findMany({ where: { orderId: { in: orderIds }, method: 'COD' } });

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
  for (const tenant of [tenants.a, tenants.b]) {
    const customer = await prisma.customer.create({
      data: { businessId: tenant.businessId, name: 'Bulk Demo' },
    });
    customers.set(tenant, customer.id);
  }
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /cod/awaiting (§2.2)', () => {
  it('lists only collected COD of this business, by courier, with amount and order number', async () => {
    const domex = await collected('1000', 'Domex');
    const koombiyo = await collected('2000', 'Koombiyo');
    const pending = await codOrder('500'); // not delivered yet
    const other = await collected('3000', 'Domex', tenants.b);

    const page = await awaiting();
    const ids = page.items.map((item) => item.orderId);
    expect(ids).toContain(domex.id);
    expect(ids).toContain(koombiyo.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(other.id);
    expect(ids.indexOf(domex.id)).toBeLessThan(ids.indexOf(koombiyo.id));
    expect(page.items.find((item) => item.orderId === domex.id)).toMatchObject({
      orderNumber: domex.orderNumber,
      recipientName: 'Bulk Demo',
      courierName: 'Domex',
      codAmount: '1350.00',
      deliveredAt: expect.any(String) as string,
    });
  });
});

describe('POST /cod/settle (§9.4)', () => {
  it('settles every chosen order with its own COD payment; replaying the key changes nothing', async () => {
    const first = await collected('1000', 'Domex');
    const second = await collected('500', 'Domex');
    const key = randomUUID();
    const body = { orderIds: [second.id, first.id], reference: 'Domex remit 12' };

    const res = await settle(body, key).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = res.body as CodBulkSettled;
    expect(result.totalAmount).toBe('2200.00');
    expect(result.settled.map((row) => [row.orderNumber, row.amount])).toEqual([
      [second.orderNumber, '850.00'],
      [first.orderNumber, '1350.00'],
    ]);
    expect(await codStatus(first.id)).toBe('SETTLED');
    expect(await codStatus(second.id)).toBe('SETTLED');
    const payments = await codPayments([first.id, second.id]);
    expect(payments).toHaveLength(2);
    expect(payments.every((payment) => payment.reference === 'Domex remit 12')).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: first.id } });
    expect(order.paymentStatus).toBe('PAID');
    // Settled orders leave the awaiting list.
    expect((await awaiting()).items.map((item) => item.orderId)).not.toContain(first.id);

    const replay = await settle(body, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(result);
    expect(await codPayments([first.id, second.id])).toHaveLength(2);
  });

  it('is all or nothing: one order that can’t be settled stops the whole remittance', async () => {
    const ready = await collected('1000', 'Domex');
    const notDelivered = await codOrder('700');
    const res = await settle({ orderIds: [ready.id, notDelivered.id] }).expect(422);
    expect(res.body).toMatchObject({ code: 'COD_NOT_COLLECTED' });
    expect((res.body as { message: string }).message).toContain(notDelivered.orderNumber);
    expect(await codStatus(ready.id)).toBe('COLLECTED');
    expect(await codPayments([ready.id, notDelivered.id])).toHaveLength(0);
    // Without the order that can't be settled, the remittance goes through.
    await settle({ orderIds: [ready.id] }).expect(200);
  });

  it('an order already settled, or a date before a delivery, is refused for the whole remittance', async () => {
    const done = await collected('1000', 'Domex');
    await settle({ orderIds: [done.id] }).expect(200);
    const fresh = await collected('1000', 'Domex');
    const again = await settle({ orderIds: [fresh.id, done.id] }).expect(422);
    expect((again.body as { message: string }).message).toContain(done.orderNumber);
    expect(await codStatus(fresh.id)).toBe('COLLECTED');

    const early = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const before = await settle({ orderIds: [fresh.id], settledAt: early }).expect(422);
    expect(before.body).toMatchObject({ code: 'SETTLED_BEFORE_DELIVERY' });
    expect(Object.keys((before.body as { fieldErrors: object }).fieldErrors)).toEqual([
      'settledAt',
    ]);
  });

  it('another business’s order is not found, and nothing is settled', async () => {
    const mine = await collected('1000', 'Domex');
    const theirs = await collected('1000', 'Domex', tenants.b);
    await settle({ orderIds: [mine.id, theirs.id] }).expect(404);
    expect(await codStatus(mine.id)).toBe('COLLECTED');
    expect(await codStatus(theirs.id)).toBe('COLLECTED');
    await settle({ orderIds: [randomUUID()] }).expect(404);
  });

  it('checks the body: some orders, no repeats, at most 50, and a key', async () => {
    const order = await collected('1000', 'Domex');
    await settle({ orderIds: [] }).expect(400);
    await settle({ orderIds: [order.id, order.id] }).expect(400);
    await settle({ orderIds: Array.from({ length: 51 }, () => randomUUID()) }).expect(400);
    await post('/cod/settle', { orderIds: [order.id] }).expect(400);
    expect(await codStatus(order.id)).toBe('COLLECTED');
  });
});
