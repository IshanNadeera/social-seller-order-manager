// GET /reports/sales against the real database (docs/DEVELOPMENT.md §9.4, §2.2, §15, task E3).
// Business A's orders are moved to known moments in October 2026 (Asia/Colombo, +5:30) so every
// figure can be checked exactly; business B's orders must never count.
// Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail, SalesReport } from '@ssom/shared';
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

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
/** Each business's customer: only WALK_IN orders may have none (orders_customer_chk). */
const customers = new Map<Tenant, string>();

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });
const post = (tenant: Tenant, path: string, body: object) =>
  request(server).post(path).set(as(tenant)).set('Idempotency-Key', randomUUID()).send(body);

const report = async (tenant: Tenant, from: string, to: string) =>
  (
    await request(server)
      .get(`${API}/reports/sales`)
      .query({ from, to })
      .set(as(tenant))
      .expect(200)
  ).body as SalesReport;

/** A cash pickup from `channel` with `items`, created at `createdAt` (UTC). */
async function order(
  tenant: Tenant,
  channel: string,
  items: object[],
  createdAt: string,
): Promise<OrderDetail> {
  const res = await post(tenant, O, {
    sourceChannel: channel,
    fulfilmentType: 'PICKUP',
    customerId: customers.get(tenant),
    items,
    paymentMethod: 'CASH',
  }).expect(201);
  const created = res.body as OrderDetail;
  await prisma.order.update({
    where: { id: created.id },
    data: { createdAt: new Date(createdAt) },
  });
  return created;
}

/** A payment or refund of `amount` on `target`, moved to `occurredAt` (UTC). */
async function money(
  tenant: Tenant,
  target: OrderDetail,
  type: string,
  amount: string,
  occurredAt: string,
) {
  const res = await post(tenant, `${O}/${target.id}/payments`, {
    type,
    method: 'CASH',
    amount,
  }).expect(201);
  const { payment } = res.body as { payment: { id: string } };
  await prisma.payment.update({
    where: { id: payment.id },
    data: { occurredAt: new Date(occurredAt) },
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
    const customer = await prisma.customer.create({
      data: { businessId: tenant.businessId, name: 'Report Demo' },
    });
    customers.set(tenant, customer.id);
  }

  const A = tenants.a;
  await prisma.business.update({ where: { id: A.businessId }, data: { timezone: 'Asia/Colombo' } });
  const saree = await prisma.product.create({
    data: { businessId: A.businessId, name: 'Silk Saree', sku: 'SS-1', sellingPrice: '1000' },
  });
  const sarees = (quantity: number) => ({ productId: saree.id, quantity });
  const custom = (name: string, unitPrice: string) => ({ name, quantity: 1, unitPrice });

  // 10 Oct: two sarees by WhatsApp (500 paid that day, 100 refunded on the 12th); five more,
  // cancelled.
  const first = await order(A, 'WHATSAPP', [sarees(2)], '2026-10-10T06:00:00Z');
  await money(A, first, 'PAYMENT', '500', '2026-10-10T06:00:00Z');
  await money(A, first, 'REFUND', '100', '2026-10-12T06:00:00Z');
  await order(A, 'WHATSAPP', [sarees(5)], '2026-10-10T07:00:00Z').then((cancelled) =>
    post(A, `${O}/${cancelled.id}/cancel`, { reason: 'Changed mind' }).expect(200),
  );
  // The saree was renamed since the first order: still one item, shown by its latest name.
  await prisma.orderItem.updateMany({
    where: { orderId: first.id },
    data: { productNameSnapshot: 'Saree (old name)' },
  });
  // 31 Oct: 06:00 UTC by Instagram; 23:45 in Colombo by Facebook, still 31 Oct there.
  await order(A, 'INSTAGRAM', [custom('GIFT WRAP', '50')], '2026-10-31T06:00:00Z');
  await order(A, 'FACEBOOK', [sarees(1), custom('Gift wrap', '200')], '2026-10-31T18:15:00Z');
  // 00:15 on 1 November in Colombo, though still 31 October in UTC.
  await order(A, 'INSTAGRAM', [custom('Gift wrap', '100')], '2026-10-31T18:45:00Z');

  // Business B, the same days: never in A's report.
  await order(tenants.b, 'WHATSAPP', [custom('Their item', '9000')], '2026-10-10T06:00:00Z');
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /reports/sales (§9.4)', () => {
  it('totals for the period follow the §15 definitions', async () => {
    const sales = await report(tenants.a, '2026-10-01', '2026-10-31');
    expect(sales).toMatchObject({ timeZone: 'Asia/Colombo', from: '2026-10-01', to: '2026-10-31' });
    expect(sales.totals).toEqual({
      ordersCreated: 4, // the cancelled one counts as created
      cancelled: 1,
      orderValue: '3250.00', // 2000 + 50 + 1200; the cancelled 5000 is left out
      averageOrderValue: '1083.33', // 3250 ÷ 3
      paymentsReceived: '500.00',
      refunds: '100.00',
      netReceived: '400.00',
    });
  });

  it('by day: local dates, only days with orders or money', async () => {
    const { byDay } = await report(tenants.a, '2026-10-01', '2026-10-31');
    expect(byDay).toEqual([
      { date: '2026-10-10', ordersCreated: 2, orderValue: '2000.00', netReceived: '500.00' },
      { date: '2026-10-12', ordersCreated: 0, orderValue: '0.00', netReceived: '-100.00' },
      { date: '2026-10-31', ordersCreated: 2, orderValue: '1250.00', netReceived: '0.00' },
    ]);
  });

  it('by source: orders not cancelled, largest value first', async () => {
    const { bySource } = await report(tenants.a, '2026-10-01', '2026-10-31');
    expect(bySource).toEqual([
      { sourceChannel: 'WHATSAPP', orders: 1, orderValue: '2000.00' },
      { sourceChannel: 'FACEBOOK', orders: 1, orderValue: '1200.00' },
      { sourceChannel: 'INSTAGRAM', orders: 1, orderValue: '50.00' },
    ]);
  });

  it('top items: a product across renames, custom items by name, cancelled orders left out', async () => {
    const { topItems } = await report(tenants.a, '2026-10-01', '2026-10-31');
    expect(topItems).toEqual([
      { name: 'Silk Saree', sku: 'SS-1', quantity: 3, value: '3000.00' },
      { name: 'Gift wrap', sku: null, quantity: 2, value: '250.00' },
    ]);
  });

  it('the next local day starts at midnight in Colombo', async () => {
    const sales = await report(tenants.a, '2026-11-01', '2026-11-01');
    expect(sales.totals).toMatchObject({ ordersCreated: 1, orderValue: '100.00' });
    expect(sales.byDay).toEqual([
      { date: '2026-11-01', ordersCreated: 1, orderValue: '100.00', netReceived: '0.00' },
    ]);
  });

  it('an empty period: zeros, no average, empty lists', async () => {
    const sales = await report(tenants.a, '2026-09-01', '2026-09-30');
    expect(sales.totals).toMatchObject({
      ordersCreated: 0,
      orderValue: '0.00',
      averageOrderValue: null,
    });
    expect([sales.byDay, sales.bySource, sales.topItems]).toEqual([[], [], []]);
  });

  it('another business sees only its own sales', async () => {
    const sales = await report(tenants.b, '2026-10-01', '2026-10-31');
    expect(sales.totals).toMatchObject({ ordersCreated: 1, orderValue: '9000.00' });
    expect(sales.topItems).toEqual([
      { name: 'Their item', sku: null, quantity: 1, value: '9000.00' },
    ]);
  });

  it.each([
    [{}, 'from'],
    [{ from: '2026-10-01' }, 'to'],
    [{ from: '2026-10-31', to: '2026-10-01' }, 'to'],
    [{ from: '2026-01-01', to: '2027-01-02' }, 'to'],
    [{ from: '2026-10-01', to: '2026-10-31', businessId: randomUUID() }, 'businessId'],
  ] as const)('refuses %o (400 on %s)', async (query, field) => {
    const res = await request(server)
      .get(`${API}/reports/sales`)
      .query(query)
      .set(as(tenants.a))
      .expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
  });
});
