// GET /dashboard/summary against the real database (docs/DEVELOPMENT.md §6.2, §15, task E1). One
// business gets an order in every state with known amounts; each figure is checked against its
// §15 definition, in the business timezone (Asia/Colombo, +5:30). A second business's orders must
// never count. Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DashboardSummary, OrderDetail } from '@ssom/shared';
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
const O = `${API}/orders`;
const ADDRESS = { recipientName: 'Dash Demo', phone: '0771234567', addressLine1: '1 Dash Road' };
/** Mid-October in UTC: comfortably inside 2026-10-01 … 2026-10-31 in Colombo. */
const OCTOBER = new Date('2026-10-15T06:00:00Z');

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
const customers = new Map<Tenant, string>();
/** Business A's orders by role in the scenario. */
const a: Record<string, OrderDetail> = {};

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });
const post = (tenant: Tenant, path: string, body: object) =>
  request(server).post(path).set(as(tenant)).set('Idempotency-Key', randomUUID()).send(body);

const summary = async (tenant: Tenant, query: Record<string, string> = {}) => {
  const res = await request(server)
    .get(`${API}/dashboard/summary`)
    .query(query)
    .set(as(tenant))
    .expect(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.body as DashboardSummary;
};

/** A pickup paid in cash, `price` in all. */
async function pickup(tenant: Tenant, price: string): Promise<OrderDetail> {
  const res = await post(tenant, O, {
    sourceChannel: 'WHATSAPP',
    fulfilmentType: 'PICKUP',
    customerId: customers.get(tenant),
    items: [{ name: 'Silk Saree', quantity: 1, unitPrice: price }],
    paymentMethod: 'CASH',
  }).expect(201);
  return res.body as OrderDetail;
}

/** A COD delivery of 1000.00 + 350.00 fee: COD 1350.00. */
async function codDelivery(tenant: Tenant): Promise<OrderDetail> {
  const res = await post(tenant, O, {
    sourceChannel: 'WHATSAPP',
    customerId: customers.get(tenant),
    items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
    deliveryFee: '350',
    paymentMethod: 'COD',
    delivery: ADDRESS,
  }).expect(201);
  return res.body as OrderDetail;
}

const step = (tenant: Tenant, order: OrderDetail, path: string, body: object = {}) =>
  post(tenant, `${O}/${order.id}${path}`, body).expect(200);
const status = (tenant: Tenant, order: OrderDetail, ...to: string[]) =>
  to.reduce<Promise<unknown>>(
    (previous, next) => previous.then(() => step(tenant, order, '/status', { to: next })),
    Promise.resolve(),
  );
const pay = (tenant: Tenant, order: OrderDetail, amount: string, type = 'PAYMENT') =>
  post(tenant, `${O}/${order.id}/payments`, { type, method: 'CASH', amount }).expect(201);

/** Moves all of `tenant`'s activity to mid-October: created, paid and delivered then. */
async function moveToOctober(tenant: Tenant) {
  const where = { businessId: tenant.businessId };
  await prisma.order.updateMany({ where, data: { createdAt: OCTOBER } });
  await prisma.payment.updateMany({ where, data: { occurredAt: OCTOBER } });
  await prisma.delivery.updateMany({
    where: { ...where, deliveredAt: { not: null } },
    data: { deliveredAt: new Date('2026-10-16T06:00:00Z') },
  });
}

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
    await prisma.business.update({
      where: { id: tenant.businessId },
      data: { timezone: 'Asia/Colombo' },
    });
    const customer = await prisma.customer.create({
      data: { businessId: tenant.businessId, name: 'Dash Demo' },
    });
    customers.set(tenant, customer.id);
  }

  const A = tenants.a;
  // Needing action: NEW 1000 with 400 paid; PENDING_CONFIRMATION 200.
  a.new = await pickup(A, '1000');
  await pay(A, a.new, '400');
  a.pending = await pickup(A, '200');
  await status(A, a.pending, 'PENDING_CONFIRMATION');
  // Ready to send: a READY pickup (500) and a READY delivery not yet dispatched (COD 1350).
  a.readyPickup = await pickup(A, '500');
  await status(A, a.readyPickup, 'CONFIRMED', 'READY');
  a.readyDelivery = await codDelivery(A);
  await status(A, a.readyDelivery, 'CONFIRMED', 'READY');
  // Out for delivery: COD 1350 on the road.
  a.dispatched = await codDelivery(A);
  await status(A, a.dispatched, 'CONFIRMED', 'READY');
  await step(A, a.dispatched, '/delivery/dispatch', { courierName: 'Domex' });
  // Delivered, COD with the courier (1350): not money received.
  a.collected = await codDelivery(A);
  await status(A, a.collected, 'CONFIRMED', 'READY');
  await step(A, a.collected, '/delivery/dispatch', { courierName: 'Domex' });
  await step(A, a.collected, '/delivery/delivered');
  // Delivered and settled: 1350 received as a COD payment.
  a.settled = await codDelivery(A);
  await status(A, a.settled, 'CONFIRMED', 'READY');
  await step(A, a.settled, '/delivery/dispatch', { courierName: 'Domex' });
  await step(A, a.settled, '/delivery/delivered');
  await step(A, a.settled, '/cod/settle');
  // Cancelled 800 with 300 still held: a refund owed.
  a.cancelled = await pickup(A, '800');
  await pay(A, a.cancelled, '300');
  await step(A, a.cancelled, '/cancel', { reason: 'Customer changed mind' });
  // Completed 600, paid in full, then 100 refunded: 100 outstanding again.
  a.completed = await pickup(A, '600');
  await pay(A, a.completed, '600');
  await status(A, a.completed, 'CONFIRMED', 'READY', 'COMPLETED');
  await pay(A, a.completed, '100', 'REFUND');

  // Business B: activity of every kind that A must never see.
  const B = tenants.b;
  const theirs = await codDelivery(B);
  await status(B, theirs, 'CONFIRMED', 'READY');
  await step(B, theirs, '/delivery/dispatch', { courierName: 'Domex' });
  await step(B, theirs, '/delivery/delivered');
  const paid = await pickup(B, '9000');
  await pay(B, paid, '5000');
  await pickup(B, '7000');
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /dashboard/summary (§15)', () => {
  it('the current state: each figure by its definition, only this business', async () => {
    const { now, timeZone } = await summary(tenants.a);
    expect(timeZone).toBe('Asia/Colombo');
    expect(now).toEqual({
      ordersNeedingAction: 2, // NEW + PENDING_CONFIRMATION
      readyToSend: 2, // the READY pickup and the READY delivery still PENDING
      outForDelivery: 1,
      // 600 + 200 + 500 + 1350 + 1350 + 1350 (COD not yet settled is still owed) + 100.
      outstandingBalance: '5450.00',
      codOutForDelivery: '1350.00', // only the dispatched one, not the READY one
      codWithCourier: '1350.00',
      refundsOwed: '300.00',
    });
  });

  it('a period: created, cancelled, delivered, order value and money, kept apart', async () => {
    await moveToOctober(tenants.a);
    const { period, today } = await summary(tenants.a, { from: '2026-10-01', to: '2026-10-31' });
    expect(period).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      ordersCreated: 9,
      cancelled: 1,
      cancellationRate: 1 / 9,
      delivered: 2,
      // Every order but the cancelled one: 1000 + 200 + 500 + 4 × 1350 + 600.
      orderValue: '7700.00',
      // 400 + 300 + 600 by hand, and the settled COD 1350; the COD still with the courier is not.
      paymentsReceived: '2650.00',
      refunds: '100.00',
      netReceived: '2550.00',
    });
    // All of A's orders were moved out of today.
    expect(today.ordersCreated).toBe(0);
  });

  it('a period with nothing in it is all zeros, and the rate is null', async () => {
    const { period } = await summary(tenants.a, { from: '2026-09-01', to: '2026-09-30' });
    expect(period).toMatchObject({
      ordersCreated: 0,
      cancellationRate: null,
      delivered: 0,
      orderValue: '0.00',
      paymentsReceived: '0.00',
      netReceived: '0.00',
    });
  });

  it('days begin at midnight in the business timezone, not UTC', async () => {
    const [lateOctober, earlyNovember] = [a.new, a.pending] as [OrderDetail, OrderDetail];
    // 23:45 on 31 October in Colombo, and 00:15 on 1 November in Colombo.
    await prisma.order.update({
      where: { id: lateOctober.id },
      data: { createdAt: new Date('2026-10-31T18:15:00Z') },
    });
    await prisma.order.update({
      where: { id: earlyNovember.id },
      data: { createdAt: new Date('2026-10-31T18:45:00Z') },
    });

    const lastDay = await summary(tenants.a, { from: '2026-10-31', to: '2026-10-31' });
    expect(lastDay.period).toMatchObject({ ordersCreated: 1, orderValue: '1000.00' });
    const firstDay = await summary(tenants.a, { from: '2026-11-01', to: '2026-11-01' });
    expect(firstDay.period).toMatchObject({ ordersCreated: 1, orderValue: '200.00' });
  });

  it('without dates the period is today; an order created now counts for today', async () => {
    const before = await summary(tenants.a);
    expect(before.period.from).toBe(before.today.date);
    expect(before.period.to).toBe(before.today.date);
    await pickup(tenants.a, '50');
    const after = await summary(tenants.a);
    expect(after.today.ordersCreated).toBe(before.today.ordersCreated + 1);
    expect(after.period.ordersCreated).toBe(before.period.ordersCreated + 1);
  });

  it('another business sees only its own figures', async () => {
    const { now } = await summary(tenants.b);
    expect(now).toEqual({
      ordersNeedingAction: 2,
      readyToSend: 0,
      outForDelivery: 0,
      outstandingBalance: '12350.00', // 1350 (COD with courier) + 4000 + 7000
      codOutForDelivery: '0.00',
      codWithCourier: '1350.00',
      refundsOwed: '0.00',
    });
  });

  it.each([
    [{ from: '2026-10-31', to: '2026-10-01' }, 'to'],
    [{ from: '2026-01-01', to: '2027-01-02' }, 'to'],
    [{ from: '2026-10-01' }, 'to'],
    [{ to: '2026-10-01' }, 'from'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'from'],
    [{ businessId: randomUUID() }, 'businessId'],
  ] as const)('refuses the query %o (400 on %s)', async (query, field) => {
    const res = await request(server)
      .get(`${API}/dashboard/summary`)
      .query(query)
      .set(as(tenants.a))
      .expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
  });

  it('needs a signed-in user', async () => {
    await request(server).get(`${API}/dashboard/summary`).expect(401);
  });
});
