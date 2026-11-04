// POST /orders/:id/status and /cancel against the real database (docs/DEVELOPMENT.md §7.2, §9.4,
// task C12). Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail } from '@ssom/shared';
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
const ADDRESS = { recipientName: 'Nimali Demo', phone: '0771234567', addressLine1: '1 Lake Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;

/** A pickup order unless `extra` says otherwise. */
async function createOrder(extra: object = {}): Promise<OrderDetail> {
  const res = await request(server)
    .post(PATH)
    .set('Authorization', `Bearer ${tenants.a.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      fulfilmentType: 'PICKUP',
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1500' }],
      paymentMethod: 'CASH',
      ...extra,
    })
    .expect(201);
  return res.body as OrderDetail;
}

const post = (path: string, body: object, tenant: Tenant = tenants.a) =>
  request(server).post(`${PATH}/${path}`).set('Authorization', `Bearer ${tenant.token}`).send(body);
const move = (id: string, to: string, reason?: string) =>
  post(`${id}/status`, reason === undefined ? { to } : { to, reason });

async function refused(res: ReturnType<typeof post>) {
  const body = (await res.expect(422)).body as {
    code: string;
    fieldErrors: Record<string, string>;
  };
  return body;
}

const statusEvents = (orderId: string) =>
  prisma.orderEvent.findMany({
    where: { businessId: tenants.a.businessId, orderId, type: { not: 'ORDER_CREATED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, actorUserId: true, oldValue: true, newValue: true, reason: true },
  });

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
  customerId = (
    await prisma.customer.create({
      data: { businessId: tenants.a.businessId, name: 'Nimali Demo', phoneDisplay: '077 123 4567' },
    })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('POST /orders/:id/status', () => {
  it('walks a pickup order through its workflow, writing an event for every change', async () => {
    const order = await createOrder();
    for (const to of ['CONFIRMED', 'PREPARING', 'READY']) {
      const res = await move(order.id, to).expect(200);
      expect((res.body as OrderDetail).orderStatus).toBe(to);
    }
    const done = (await move(order.id, 'COMPLETED').expect(200)).body as OrderDetail;
    expect(done).toMatchObject({ orderStatus: 'COMPLETED', stage: 'COMPLETED' });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.completedAt).toBeInstanceOf(Date);

    const events = await statusEvents(order.id);
    expect(events.map((event) => [event.oldValue, event.newValue])).toEqual([
      [{ orderStatus: 'NEW' }, { orderStatus: 'CONFIRMED' }],
      [{ orderStatus: 'CONFIRMED' }, { orderStatus: 'PREPARING' }],
      [{ orderStatus: 'PREPARING' }, { orderStatus: 'READY' }],
      [{ orderStatus: 'READY' }, { orderStatus: 'COMPLETED' }],
    ]);
    expect(events.every((event) => event.type === 'ORDER_STATUS_CHANGED')).toBe(true);
    expect(events.every((event) => event.actorUserId === tenants.a.userId)).toBe(true);
  });

  it('refuses moves the transition table does not allow, and writes nothing', async () => {
    const order = await createOrder();
    for (const to of ['READY', 'NEW', 'COMPLETED']) {
      const body = await refused(move(order.id, to));
      expect(body).toMatchObject({
        code: 'INVALID_TRANSITION',
        fieldErrors: { to: expect.any(String) },
      });
    }
    expect(await statusEvents(order.id)).toEqual([]);
  });

  it('a delivery order completes through its delivery, not here', async () => {
    const order = await createOrder({ fulfilmentType: 'DELIVERY', delivery: ADDRESS });
    await move(order.id, 'CONFIRMED').expect(200);
    await move(order.id, 'READY').expect(200);
    expect((await refused(move(order.id, 'COMPLETED'))).code).toBe('INVALID_TRANSITION');
  });

  it('returning a completed pickup order is an owner correction with a reason', async () => {
    const order = await createOrder();
    for (const to of ['CONFIRMED', 'READY', 'COMPLETED']) await move(order.id, to).expect(200);
    expect((await refused(move(order.id, 'RETURNED'))).code).toBe('REASON_REQUIRED');
    const returned = (await move(order.id, 'RETURNED', 'Wrong size').expect(200))
      .body as OrderDetail;
    expect(returned).toMatchObject({ orderStatus: 'RETURNED', balanceDue: '0.00' });
    expect((await statusEvents(order.id)).at(-1)).toMatchObject({
      newValue: { orderStatus: 'RETURNED' },
      reason: 'Wrong size',
    });
  });

  it('two changes at once: the order lock lets only one through', async () => {
    const order = await createOrder();
    const results = await Promise.all([move(order.id, 'CONFIRMED'), move(order.id, 'CONFIRMED')]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);
    expect(await statusEvents(order.id)).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('needs a reason, on both endpoints', async () => {
    const order = await createOrder();
    const res = await post(`${order.id}/cancel`, {}).expect(400);
    expect((res.body as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({
      reason: 'Please give a reason.',
    });
    const body = await refused(move(order.id, 'CANCELLED'));
    expect(body).toMatchObject({
      code: 'REASON_REQUIRED',
      fieldErrors: { reason: 'Please give a reason.' },
    });
  });

  it('cancels with the reason; COD becomes NOT_APPLICABLE; both changes are logged', async () => {
    const order = await createOrder({
      fulfilmentType: 'DELIVERY',
      delivery: ADDRESS,
      paymentMethod: 'COD',
    });
    expect(order.delivery).toMatchObject({ codStatus: 'PENDING' });

    const cancelled = (
      await post(`${order.id}/cancel`, { reason: ' Customer changed their mind ' }).expect(200)
    ).body as OrderDetail;
    expect(cancelled).toMatchObject({
      orderStatus: 'CANCELLED',
      stage: 'CANCELLED',
      balanceDue: '0.00',
    });
    expect(cancelled.delivery).toMatchObject({ status: 'PENDING', codStatus: 'NOT_APPLICABLE' });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.cancelReason).toBe('Customer changed their mind');
    expect(row.cancelledAt).toBeInstanceOf(Date);

    expect(await statusEvents(order.id)).toMatchObject([
      {
        type: 'ORDER_STATUS_CHANGED',
        oldValue: { orderStatus: 'NEW' },
        newValue: { orderStatus: 'CANCELLED' },
        reason: 'Customer changed their mind',
      },
      {
        type: 'COD_STATUS_CHANGED',
        oldValue: { codStatus: 'PENDING' },
        newValue: { codStatus: 'NOT_APPLICABLE' },
      },
    ]);

    // Terminal: nothing follows a cancellation.
    expect((await refused(post(`${order.id}/cancel`, { reason: 'Again' }))).code).toBe(
      'INVALID_TRANSITION',
    );
    expect((await refused(move(order.id, 'CONFIRMED'))).code).toBe('INVALID_TRANSITION');
  });

  it('a dispatched order can no longer be cancelled', async () => {
    const order = await createOrder({ fulfilmentType: 'DELIVERY', delivery: ADDRESS });
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: 'READY' } });
    await prisma.delivery.update({ where: { orderId: order.id }, data: { status: 'DISPATCHED' } });
    expect((await refused(post(`${order.id}/cancel`, { reason: 'Too late' }))).code).toBe(
      'ORDER_DISPATCHED',
    );
  });
});

describe('requests', () => {
  it("answers 404 for another business's order, an unknown ID and a non-UUID", async () => {
    const order = await createOrder();
    await post(`${order.id}/status`, { to: 'CONFIRMED' }, tenants.b).expect(404);
    await post(`${order.id}/cancel`, { reason: 'x' }, tenants.b).expect(404);
    await post(`${randomUUID()}/status`, { to: 'CONFIRMED' }).expect(404);
    await post('not-a-uuid/cancel', { reason: 'x' }).expect(404);
  });

  it('refuses unknown statuses and fields (400)', async () => {
    const order = await createOrder();
    const res = await post(`${order.id}/status`, {
      to: 'SHIPPED',
      businessId: tenants.b.businessId,
    }).expect(400);
    expect((res.body as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({
      to: 'Choose a status from the list.',
      businessId: 'This field is not allowed.',
    });
  });
});
