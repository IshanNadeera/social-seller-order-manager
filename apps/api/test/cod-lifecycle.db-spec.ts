// The full cash-on-delivery lifecycle against the real database (docs/DEVELOPMENT.md §7.8, §7.2,
// ADR-007, task D4): create → ready → dispatch → delivered (COLLECTED) → settle (SETTLED, one COD
// payment), and every way a settle can go wrong. Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderDetail, Page, PaymentRecorded, PaymentView } from '@ssom/shared';
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
const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = { recipientName: 'Cod Demo', phone: '0771234567', addressLine1: '1 Cod Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;

const auth = (tenant: Tenant = tenants.a) => ({ Authorization: `Bearer ${tenant.token}` });
const call = (method: 'post' | 'get', path: string, body?: object, tenant: Tenant = tenants.a) => {
  const req = request(server)[method](`${O}${path}`).set(auth(tenant));
  return body === undefined ? req : req.send(body);
};

/** A COD order of 1000.00 + 350.00 delivery fee, with a 350.00 advance: COD 1000.00. */
async function codOrder(): Promise<OrderDetail> {
  const res = await request(server)
    .post(O)
    .set(auth())
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
      deliveryFee: '350',
      paymentMethod: 'COD',
      initialPayment: { amount: '350', method: 'BANK_TRANSFER' },
      delivery: ADDRESS,
    })
    .expect(201);
  return res.body as OrderDetail;
}

/** Takes an order from NEW to a delivered parcel (COD COLLECTED). */
async function deliver(orderId: string): Promise<OrderDetail> {
  await call('post', `/${orderId}/status`, { to: 'CONFIRMED' }).expect(200);
  await call('post', `/${orderId}/status`, { to: 'READY' }).expect(200);
  await call('post', `/${orderId}/delivery/dispatch`, { courierName: 'Domex' }).expect(200);
  return (await call('post', `/${orderId}/delivery/delivered`, {}).expect(200)).body as OrderDetail;
}

const settle = (
  orderId: string,
  body: object = {},
  key: string = randomUUID(),
  tenant: Tenant = tenants.a,
) => call('post', `/${orderId}/cod/settle`, body, tenant).set('Idempotency-Key', key);

async function refused(res: ReturnType<typeof settle>, status = 422) {
  return (await res.expect(status)).body as { code: string; fieldErrors: Record<string, string> };
}

const codPayments = (orderId: string) =>
  prisma.payment.findMany({ where: { businessId: tenants.a.businessId, orderId, method: 'COD' } });

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
    await prisma.customer.create({ data: { businessId: tenants.a.businessId, name: 'Cod Demo' } })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('the COD lifecycle (§7.8)', () => {
  it('create → dispatch → delivered → settled: exactly one COD payment; replaying the key changes nothing', async () => {
    // 1. Created: COD is the balance after the advance, pending.
    const order = await codOrder();
    expect(order).toMatchObject({
      totalAmount: '1350.00',
      amountPaid: '350.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(order.delivery).toMatchObject({ codAmount: '1000.00', codStatus: 'PENDING' });

    // 2–3. Dispatched (amount frozen) and delivered: the courier has the money; no payment yet.
    const delivered = await deliver(order.id);
    expect(delivered).toMatchObject({
      orderStatus: 'COMPLETED',
      amountPaid: '350.00',
      balanceDue: '1000.00',
    });
    expect(delivered.delivery).toMatchObject({ status: 'DELIVERED', codStatus: 'COLLECTED' });
    expect(await codPayments(order.id)).toHaveLength(0);

    // 4. Settled, dated when the courier paid: one COD payment for the COD amount.
    // Dated now: it can't be before the delivery that just happened.
    const settledAt = new Date().toISOString();
    const key = randomUUID();
    const res = await settle(order.id, { settledAt, reference: 'Domex remit 7' }, key).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const settled = res.body as PaymentRecorded;
    expect(settled.payment).toMatchObject({
      type: 'PAYMENT',
      method: 'COD',
      amount: '1000.00',
      occurredAt: settledAt,
      reference: 'Domex remit 7',
    });
    expect(settled.order).toMatchObject({
      amountPaid: '1350.00',
      balanceDue: '0.00',
      paymentStatus: 'PAID',
    });
    expect(settled.order.delivery).toMatchObject({ codStatus: 'SETTLED', codAmount: '1000.00' });
    const row = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(row.codPaymentId).toBe(settled.payment.id);
    expect(row.codSettledAt?.toISOString()).toBe(settledAt);

    // The history says what happened, in order.
    const events = await prisma.orderEvent.findMany({
      where: { businessId: tenants.a.businessId, orderId: order.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { type: true, oldValue: true, newValue: true },
    });
    expect(events.slice(-2)).toMatchObject([
      {
        type: 'PAYMENT_RECORDED',
        newValue: { amount: '1000.00', method: 'COD', paymentId: settled.payment.id },
      },
      {
        type: 'COD_STATUS_CHANGED',
        oldValue: { codStatus: 'COLLECTED' },
        newValue: { codStatus: 'SETTLED' },
      },
    ]);

    // A retry with the same key (e.g. the phone lost its connection): the stored answer, nothing new.
    const again = await settle(order.id, { settledAt, reference: 'Domex remit 7' }, key).expect(
      200,
    );
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(res.body);
    expect(await codPayments(order.id)).toHaveLength(1);

    // A second settle with a new key: refused, still one payment.
    const twice = await refused(settle(order.id));
    expect(twice.code).toBe('COD_NOT_COLLECTED');
    expect(await codPayments(order.id)).toHaveLength(1);

    const payments = (await call('get', `/${order.id}/payments`).expect(200))
      .body as Page<PaymentView>;
    expect(payments.items.map((payment) => [payment.method, payment.amount])).toEqual([
      ['BANK_TRANSFER', '350.00'],
      ['COD', '1000.00'],
    ]);
  });

  it('a settled order returned later keeps its COD settled; the money becomes a refund owed', async () => {
    const order = await codOrder();
    await deliver(order.id);
    await settle(order.id).expect(200);
    const returned = (
      await call('post', `/${order.id}/delivery/returned`, { reason: 'Damaged' }).expect(200)
    ).body as OrderDetail;
    expect(returned).toMatchObject({ orderStatus: 'RETURNED', refundOwed: '1350.00' });
    expect(returned.delivery).toMatchObject({ codStatus: 'SETTLED' });
  });
});

describe('a settle that is refused writes nothing', () => {
  it('before delivery: the courier hasn’t collected anything', async () => {
    const order = await codOrder();
    expect((await refused(settle(order.id))).code).toBe('COD_NOT_COLLECTED');
    await call('post', `/${order.id}/status`, { to: 'CONFIRMED' }).expect(200);
    await call('post', `/${order.id}/status`, { to: 'READY' }).expect(200);
    await call('post', `/${order.id}/delivery/dispatch`, {}).expect(200);
    expect((await refused(settle(order.id))).code).toBe('COD_NOT_COLLECTED');
    expect(await codPayments(order.id)).toHaveLength(0);
  });

  it('a settlement dated before the delivery, or more than 90 days back', async () => {
    const order = await codOrder();
    await deliver(order.id);
    const early = await refused(
      settle(order.id, { settledAt: new Date(Date.now() - DAY).toISOString() }),
    );
    expect(early).toMatchObject({
      code: 'SETTLED_BEFORE_DELIVERY',
      fieldErrors: { settledAt: expect.any(String) },
    });
    const old = await refused(
      settle(order.id, { settledAt: new Date(Date.now() - 91 * DAY).toISOString() }),
      400,
    );
    expect(Object.keys(old.fieldErrors)).toEqual(['settledAt']);
    expect(await codPayments(order.id)).toHaveLength(0);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).codStatus,
    ).toBe('COLLECTED');
  });

  it('without an Idempotency-Key (400), with a client amount (400), or on a pickup order (422)', async () => {
    const order = await codOrder();
    await deliver(order.id);
    await call('post', `/${order.id}/cod/settle`, {}).expect(400);
    await refused(settle(order.id, { amount: '1.00' }), 400);

    const pickup = (
      await request(server)
        .post(O)
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceChannel: 'WHATSAPP',
          customerId,
          fulfilmentType: 'PICKUP',
          items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
          paymentMethod: 'CASH',
        })
        .expect(201)
    ).body as OrderDetail;
    expect((await refused(settle(pickup.id))).code).toBe('NOT_A_DELIVERY_ORDER');
    expect(await codPayments(order.id)).toHaveLength(0);
  });

  it("another business's order, an unknown ID and a non-UUID are 404", async () => {
    const order = await codOrder();
    await deliver(order.id);
    await settle(order.id, {}, randomUUID(), tenants.b).expect(404);
    await settle(randomUUID()).expect(404);
    await settle('not-a-uuid').expect(404);
    expect(await codPayments(order.id)).toHaveLength(0);
  });
});
