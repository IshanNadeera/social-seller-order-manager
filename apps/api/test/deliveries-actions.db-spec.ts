// Delivery actions against the real database (docs/DEVELOPMENT.md §7.2, §7.8, ADR-012, task D3):
// dispatch, delivered, failed, returned, and their side effects on the order and COD status.
// Run with: npm run test:db -w apps/api. Fake data only.
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

const O = '/api/v1/orders';
const ADDRESS = { recipientName: 'Ship Demo', phone: '0771234567', addressLine1: '1 Ship Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;
let staff: Tenant;

const auth = (tenant: Tenant = tenants.a) => ({ Authorization: `Bearer ${tenant.token}` });

/** A READY 1000.00 COD delivery order (no fee), unless `extra` says otherwise. */
async function readyOrder(extra: object = {}, ready = true): Promise<OrderDetail> {
  const res = await request(server)
    .post(O)
    .set(auth())
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
      deliveryFee: '0',
      paymentMethod: 'COD',
      delivery: ADDRESS,
      ...extra,
    })
    .expect(201);
  const order = res.body as OrderDetail;
  if (!ready) return order;
  for (const to of ['CONFIRMED', 'READY']) {
    await request(server).post(`${O}/${order.id}/status`).set(auth()).send({ to }).expect(200);
  }
  return order;
}

const act = (orderId: string, action: string, body: object = {}, tenant: Tenant = tenants.a) =>
  request(server).post(`${O}/${orderId}/delivery/${action}`).set(auth(tenant)).send(body);

async function done(res: ReturnType<typeof act>) {
  return (await res.expect(200)).body as OrderDetail;
}

async function refused(res: ReturnType<typeof act>, status = 422) {
  return (await res.expect(status)).body as { code: string; fieldErrors: Record<string, string> };
}

const deliveryRow = (orderId: string) => prisma.delivery.findUniqueOrThrow({ where: { orderId } });

/** The order's events after it was created and made ready. */
const eventsOf = async (orderId: string) =>
  (
    await prisma.orderEvent.findMany({
      where: { businessId: tenants.a.businessId, orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { type: true, oldValue: true, newValue: true, reason: true },
    })
  ).filter((event) => event.type !== 'ORDER_CREATED');

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
    await prisma.customer.create({ data: { businessId: tenants.a.businessId, name: 'Ship Demo' } })
  ).id;

  // A STAFF member of business A, for the owner-only correction.
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

describe('dispatch → delivered (§7.2)', () => {
  it('dispatches a ready order; delivered completes it and puts the COD with the courier, in one go', async () => {
    const order = await readyOrder();
    const sent = await done(
      act(order.id, 'dispatch', { courierName: 'Domex', trackingNumber: 'DX1' }),
    );
    expect(sent).toMatchObject({ orderStatus: 'READY', stage: 'OUT_FOR_DELIVERY' });
    expect(sent.delivery).toMatchObject({
      status: 'DISPATCHED',
      courierName: 'Domex',
      codStatus: 'PENDING',
    });
    const dispatched = await deliveryRow(order.id);
    expect(dispatched.attemptCount).toBe(1);
    expect(dispatched.dispatchedAt).toBeInstanceOf(Date);

    const delivered = await done(act(order.id, 'delivered'));
    expect(delivered).toMatchObject({ orderStatus: 'COMPLETED', stage: 'COMPLETED' });
    expect(delivered.delivery).toMatchObject({
      status: 'DELIVERED',
      codStatus: 'COLLECTED',
      codAmount: '1000.00',
    });
    // No payment yet: COD money is recorded when it is settled (§7.8).
    expect(delivered.amountPaid).toBe('0.00');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.completedAt).toBeInstanceOf(Date);

    const events = await eventsOf(order.id);
    expect(events.slice(-4)).toMatchObject([
      {
        type: 'DELIVERY_STATUS_CHANGED',
        oldValue: { deliveryStatus: 'PENDING' },
        newValue: { deliveryStatus: 'DISPATCHED', attemptCount: 1, courierName: 'Domex' },
      },
      { type: 'DELIVERY_STATUS_CHANGED', newValue: { deliveryStatus: 'DELIVERED' } },
      {
        type: 'ORDER_STATUS_CHANGED',
        oldValue: { orderStatus: 'READY' },
        newValue: { orderStatus: 'COMPLETED' },
      },
      {
        type: 'COD_STATUS_CHANGED',
        oldValue: { codStatus: 'PENDING' },
        newValue: { codStatus: 'COLLECTED' },
      },
    ]);
  });

  it('only a ready order can be dispatched; steps can’t be skipped or repeated', async () => {
    const order = await readyOrder({}, false);
    expect(await refused(act(order.id, 'dispatch'))).toMatchObject({ code: 'INVALID_TRANSITION' });
    await request(server)
      .post(`${O}/${order.id}/status`)
      .set(auth())
      .send({ to: 'CONFIRMED' })
      .expect(200);
    expect((await refused(act(order.id, 'delivered'))).code).toBe('INVALID_TRANSITION');
    await request(server)
      .post(`${O}/${order.id}/status`)
      .set(auth())
      .send({ to: 'READY' })
      .expect(200);
    await done(act(order.id, 'dispatch'));
    expect((await refused(act(order.id, 'dispatch'))).code).toBe('INVALID_TRANSITION');
    expect((await deliveryRow(order.id)).status).toBe('DISPATCHED');
  });
});

describe('failed attempts and returns', () => {
  it('a failure needs a reason; it can be sent again (second attempt) and then delivered', async () => {
    const order = await readyOrder();
    await done(act(order.id, 'dispatch'));
    const body = await refused(act(order.id, 'failed', {}), 400);
    expect(body.fieldErrors).toEqual({ reason: 'Say why the delivery failed.' });

    const failed = await done(act(order.id, 'failed', { reason: 'Nobody home' }));
    expect(failed).toMatchObject({ stage: 'DELIVERY_FAILED', delivery: { status: 'FAILED' } });
    expect((await deliveryRow(order.id)).failedReason).toBe('Nobody home');

    await done(act(order.id, 'dispatch'));
    expect((await deliveryRow(order.id)).attemptCount).toBe(2);
    expect((await done(act(order.id, 'delivered'))).orderStatus).toBe('COMPLETED');
    expect(
      (await eventsOf(order.id)).find(
        (event) => event.newValue && JSON.stringify(event.newValue).includes('FAILED'),
      ),
    ).toMatchObject({
      reason: 'Nobody home',
    });
  });

  it('a failed delivery returned: the order is RETURNED and the COD still to come is cancelled', async () => {
    const order = await readyOrder();
    await done(act(order.id, 'dispatch'));
    await done(act(order.id, 'failed', { reason: 'Wrong address' }));
    const returned = await done(act(order.id, 'returned', {}));
    expect(returned).toMatchObject({
      orderStatus: 'RETURNED',
      stage: 'RETURNED',
      balanceDue: '0.00',
    });
    expect(returned.delivery).toMatchObject({ status: 'RETURNED', codStatus: 'NOT_APPLICABLE' });
    expect((await eventsOf(order.id)).slice(-3).map((event) => event.type)).toEqual([
      'DELIVERY_STATUS_CHANGED',
      'ORDER_STATUS_CHANGED',
      'COD_STATUS_CHANGED',
    ]);
    // Nothing follows a return.
    expect((await refused(act(order.id, 'dispatch'))).code).toBe('INVALID_TRANSITION');
  });

  it('returning a delivered parcel is an owner correction with a reason; money received becomes a refund owed', async () => {
    const order = await readyOrder({ initialPayment: { amount: '300', method: 'CASH' } });
    await done(act(order.id, 'dispatch'));
    await done(act(order.id, 'delivered'));

    expect((await refused(act(order.id, 'returned', {}))).code).toBe('REASON_REQUIRED');
    expect((await refused(act(order.id, 'returned', { reason: 'Damaged' }, staff))).code).toBe(
      'OWNER_ONLY',
    );

    const returned = await done(act(order.id, 'returned', { reason: 'Damaged' }));
    expect(returned).toMatchObject({
      orderStatus: 'RETURNED',
      refundOwed: '300.00',
      balanceDue: '0.00',
    });
    expect(returned.delivery).toMatchObject({ codStatus: 'NOT_APPLICABLE' });
    expect((await eventsOf(order.id)).at(-3)).toMatchObject({
      type: 'DELIVERY_STATUS_CHANGED',
      newValue: { deliveryStatus: 'RETURNED' },
      reason: 'Damaged',
    });
  });

  it('a non-COD order changes no COD status', async () => {
    const order = await readyOrder({ paymentMethod: 'CASH' });
    await done(act(order.id, 'dispatch'));
    const delivered = await done(act(order.id, 'delivered'));
    expect(delivered.delivery).toMatchObject({ codStatus: 'NOT_APPLICABLE' });
    expect((await eventsOf(order.id)).map((event) => event.type)).not.toContain(
      'COD_STATUS_CHANGED',
    );
  });
});

describe('requests', () => {
  it('a pickup order has no delivery actions', async () => {
    const order = await readyOrder({
      fulfilmentType: 'PICKUP',
      paymentMethod: 'CASH',
      delivery: undefined,
      deliveryFee: undefined,
    });
    expect((await refused(act(order.id, 'dispatch'))).code).toBe('NOT_A_DELIVERY_ORDER');
  });

  it('refuses a status or other extras in the body (400)', async () => {
    const order = await readyOrder();
    await refused(act(order.id, 'dispatch', { status: 'DELIVERED' }), 400);
    await refused(act(order.id, 'delivered', { codStatus: 'SETTLED' }), 400);
    expect((await deliveryRow(order.id)).status).toBe('PENDING');
  });

  it("another business's order, an unknown ID and a non-UUID are 404, and nothing changes", async () => {
    const order = await readyOrder();
    for (const action of ['dispatch', 'delivered', 'failed', 'returned']) {
      const body = action === 'failed' ? { reason: 'x' } : {};
      await act(order.id, action, body, tenants.b).expect(404);
      await act(randomUUID(), action, body).expect(404);
      await act('not-a-uuid', action, body).expect(404);
    }
    expect((await deliveryRow(order.id)).status).toBe('PENDING');
  });
});
