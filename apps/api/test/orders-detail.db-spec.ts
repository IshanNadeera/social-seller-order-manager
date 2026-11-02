// GET /orders/:id and GET /orders/:id/events against the real database (docs/DEVELOPMENT.md §9.4,
// task C10). Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail, OrderEventView, Page } from '@ssom/shared';
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

const PATH = '/api/v1/orders';

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let created: OrderDetail;

const get = (path: string, tenant: Tenant = tenants.a) =>
  request(server).get(path).set('Authorization', `Bearer ${tenant.token}`);

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

  const a = tenants.a.businessId;
  const customerId = (
    await prisma.customer.create({
      data: { businessId: a, name: 'Nimali Demo', phoneDisplay: '077 123 4567' },
    })
  ).id;
  const productId = (
    await prisma.product.create({
      data: { businessId: a, name: 'Silk Saree', sku: 'SAR-1', sellingPrice: '1500.00' },
    })
  ).id;
  // A COD delivery order with an advance: two events (created, payment recorded).
  const res = await request(server)
    .post(PATH)
    .set('Authorization', `Bearer ${tenants.a.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      items: [
        { productId, quantity: 2 },
        { name: 'Gift wrapping', quantity: 1, unitPrice: '200.00' },
      ],
      deliveryFee: '350.00',
      paymentMethod: 'COD',
      initialPayment: { amount: '500.00', method: 'CASH' },
      delivery: {
        recipientName: 'Nimali Demo',
        phone: '0771234567',
        addressLine1: '1 Lake Road',
        city: 'Kandy',
        district: 'Kandy',
      },
    })
    .expect(201);
  created = res.body as OrderDetail;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /orders/:id', () => {
  it('returns the order with items, delivery and payment summary (the same view as create)', async () => {
    const res = await get(`${PATH}/${created.id}`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const order = res.body as OrderDetail;
    expect(order).toEqual(created);
    expect(order.items).toHaveLength(2);
    expect(order).toMatchObject({
      totalAmount: '3550.00',
      amountPaid: '500.00',
      balanceDue: '3050.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(order.delivery).toMatchObject({ recipientName: 'Nimali Demo', codAmount: '3050.00' });
  });

  it("answers 404 for another business's order, an unknown ID and a non-UUID", async () => {
    expect((await get(`${PATH}/${created.id}`, tenants.b).expect(404)).body).toMatchObject({
      code: 'NOT_FOUND',
    });
    await get(`${PATH}/${randomUUID()}`).expect(404);
    await get(`${PATH}/not-a-uuid`).expect(404);
  });
});

describe('GET /orders/:id/events', () => {
  it('lists the history oldest first, with who did it', async () => {
    const res = await get(`${PATH}/${created.id}/events`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const page = res.body as Page<OrderEventView>;
    expect(page).toMatchObject({ page: 1, pageSize: 25, total: 2 });
    expect(page.items.map((event) => event.type)).toEqual(['ORDER_CREATED', 'PAYMENT_RECORDED']);
    const [first] = page.items;
    expect(first?.actor).toEqual({ id: tenants.a.userId, name: tenants.a.email });
    expect(first?.newValue).toMatchObject({ orderNumber: created.orderNumber, itemCount: 2 });
    expect(first?.reason).toBe(null);
  });

  it('pages', async () => {
    const second = (await get(`${PATH}/${created.id}/events?pageSize=1&page=2`).expect(200))
      .body as Page<OrderEventView>;
    expect(second.total).toBe(2);
    expect(second.items.map((event) => event.type)).toEqual(['PAYMENT_RECORDED']);
  });

  it("answers 404 for another business's order and 400 for a bad query", async () => {
    await get(`${PATH}/${created.id}/events`, tenants.b).expect(404);
    await get(`${PATH}/not-a-uuid/events`).expect(404);
    const bad = await get(`${PATH}/${created.id}/events?pageSize=101`).expect(400);
    expect((bad.body as { fieldErrors: unknown }).fieldErrors).toEqual({
      pageSize: 'Use at most 100.',
    });
  });
});
