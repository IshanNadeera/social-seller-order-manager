// GET /customers/:id/orders against the real database (docs/DEVELOPMENT.md §9.2, §6.6, task C16).
// Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderSummary, Page } from '@ssom/shared';
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

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let nimali: string;
let kasun: string;
let customerOfB: string;
let seq = 0;

/** Inserts an order directly (creation itself is tested in orders-create.db-spec.ts). */
async function seed(tenant: Tenant, customerId: string, createdAt: string, name: string) {
  seq += 1;
  await prisma.order.create({
    data: {
      businessId: tenant.businessId,
      orderNumber: `CUS-${String(seq).padStart(4, '0')}`,
      customerId,
      sourceChannel: 'WHATSAPP',
      fulfilmentType: 'PICKUP',
      orderStatus: 'NEW',
      paymentStatus: 'UNPAID',
      paymentMethod: 'CASH',
      currency: 'LKR',
      subtotal: '1000.00',
      totalAmount: '1000.00',
      amountPaid: '0.00',
      customerNameSnapshot: name,
      customerPhoneSnapshot: '077 123 4567',
      createdById: tenant.userId,
      createdAt: new Date(createdAt),
    },
  });
}

const history = (
  customerId: string,
  query: Record<string, string> = {},
  tenant: Tenant = tenants.a,
) =>
  request(server)
    .get(`/api/v1/customers/${customerId}/orders`)
    .query(query)
    .set('Authorization', `Bearer ${tenant.token}`);

beforeAll(async () => {
  const env = parseEnv(process.env);
  const auth = await createTestAuth(env.SUPABASE_JWT_ISSUER);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(JWKS)
    .useValue(auth.jwks)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, env);
  await app.init();
  server = app.getHttpServer();
  prisma = moduleRef.get(PrismaService);
  tenants = await createTwoTenants(prisma, auth);

  const customer = async (tenant: Tenant, name: string) =>
    (await prisma.customer.create({ data: { businessId: tenant.businessId, name } })).id;
  nimali = await customer(tenants.a, 'Nimali Demo');
  kasun = await customer(tenants.a, 'Kasun Demo');
  customerOfB = await customer(tenants.b, 'Other Business Demo');

  await seed(tenants.a, nimali, '2026-10-01T06:00:00.000Z', 'Nimali Demo');
  await seed(tenants.a, nimali, '2026-10-20T06:00:00.000Z', 'Nimali Demo');
  await seed(tenants.a, nimali, '2026-11-01T06:00:00.000Z', 'Nimali Demo');
  await seed(tenants.a, kasun, '2026-11-02T06:00:00.000Z', 'Kasun Demo');
  await seed(tenants.b, customerOfB, '2026-11-03T06:00:00.000Z', 'Other Business Demo');
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /customers/:id/orders', () => {
  it('lists only this customer’s orders, newest first, as on the orders list', async () => {
    const res = await history(nimali).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const page = res.body as Page<OrderSummary>;
    expect(page).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(page.items.map((order) => order.createdAt)).toEqual([
      '2026-11-01T06:00:00.000Z',
      '2026-10-20T06:00:00.000Z',
      '2026-10-01T06:00:00.000Z',
    ]);
    expect(page.items[0]).toMatchObject({
      customerName: 'Nimali Demo',
      customerPhoneMasked: '077 ••• 4567',
      stage: 'NEW',
      totalAmount: '1000.00',
      balanceDue: '1000.00',
    });
  });

  it('pages without overlap', async () => {
    const first = (await history(nimali, { pageSize: '2' }).expect(200)).body as Page<OrderSummary>;
    const second = (await history(nimali, { pageSize: '2', page: '2' }).expect(200))
      .body as Page<OrderSummary>;
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((order) => order.id)).size).toBe(3);
  });

  it('keeps the history of an archived customer, and is empty for one without orders', async () => {
    await prisma.customer.update({ where: { id: kasun }, data: { archivedAt: new Date() } });
    expect(((await history(kasun).expect(200)).body as Page<OrderSummary>).total).toBe(1);
    const fresh = await prisma.customer.create({
      data: { businessId: tenants.a.businessId, name: 'New Demo' },
    });
    expect((await history(fresh.id).expect(200)).body).toMatchObject({ items: [], total: 0 });
  });

  it("answers 404 for another business's customer, an unknown ID and a non-UUID", async () => {
    await history(customerOfB).expect(404);
    await history(nimali, {}, tenants.b).expect(404);
    await history(randomUUID()).expect(404);
    await history('not-a-uuid').expect(404);
  });

  it('refuses a page size over 100 and unknown query fields (400)', async () => {
    const res = await history(nimali, { pageSize: '101', orderStatus: 'NEW' }).expect(400);
    expect((res.body as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({
      pageSize: 'Use at most 100.',
      orderStatus: 'This field is not allowed.',
    });
  });
});
