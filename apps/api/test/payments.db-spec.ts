// Payments and refunds against the real database (docs/DEVELOPMENT.md §7.7, §7.8, ADR-014, task D1).
// Run with: npm run test:db -w apps/api. Fake data only.
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
const ADDRESS = { recipientName: 'Pay Demo', phone: '0771234567', addressLine1: '1 Pay Road' };

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;

const auth = (tenant: Tenant = tenants.a) => ({ Authorization: `Bearer ${tenant.token}` });

/** An order of one 1000.00 item: a cash pickup unless `extra` says otherwise. */
async function createOrder(extra: object = {}): Promise<OrderDetail> {
  const res = await request(server)
    .post(O)
    .set(auth())
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      fulfilmentType: 'PICKUP',
      items: [{ name: 'Silk Saree', quantity: 1, unitPrice: '1000' }],
      paymentMethod: 'CASH',
      ...extra,
    })
    .expect(201);
  return res.body as OrderDetail;
}

/** A COD delivery order: 1000.00, no delivery fee, all of it on delivery. */
const codOrder = () =>
  createOrder({
    fulfilmentType: 'DELIVERY',
    paymentMethod: 'COD',
    deliveryFee: '0',
    delivery: ADDRESS,
  });

const pay = (
  orderId: string,
  body: object,
  key: string = randomUUID(),
  tenant: Tenant = tenants.a,
) =>
  request(server)
    .post(`${O}/${orderId}/payments`)
    .set(auth(tenant))
    .set('Idempotency-Key', key)
    .send({ type: 'PAYMENT', method: 'CASH', ...body });

const refund = (orderId: string, body: object) => pay(orderId, { type: 'REFUND', ...body });

async function refused(res: ReturnType<typeof pay>, status = 422) {
  return (await res.expect(status)).body as { code: string; fieldErrors: Record<string, string> };
}

const paymentRows = (orderId: string) =>
  prisma.payment.findMany({ where: { businessId: tenants.a.businessId, orderId } });
const eventsOf = (orderId: string) =>
  prisma.orderEvent.findMany({
    where: { businessId: tenants.a.businessId, orderId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, oldValue: true, newValue: true },
  });

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
    await prisma.customer.create({
      data: { businessId: tenants.a.businessId, name: 'Pay Demo', phoneDisplay: '077 123 4567' },
    })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('payments (§7.7)', () => {
  it('records part and full payments; the summary follows in the same transaction; history logged', async () => {
    const order = await createOrder();
    const first = await pay(order.id, { amount: '400', reference: 'Receipt 12' }).expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const recorded = first.body as PaymentRecorded;
    expect(recorded.payment).toMatchObject({
      type: 'PAYMENT',
      method: 'CASH',
      amount: '400.00',
      reference: 'Receipt 12',
      refundOfPaymentId: null,
      recordedBy: { id: tenants.a.userId, name: tenants.a.email },
    });
    expect(recorded.order).toMatchObject({
      amountPaid: '400.00',
      balanceDue: '600.00',
      paymentStatus: 'PARTIALLY_PAID',
    });

    const second = (await pay(order.id, { amount: '600', method: 'BANK_TRANSFER' }).expect(201))
      .body as PaymentRecorded;
    expect(second.order).toMatchObject({
      amountPaid: '1000.00',
      balanceDue: '0.00',
      paymentStatus: 'PAID',
    });

    const list = (await request(server).get(`${O}/${order.id}/payments`).set(auth()).expect(200))
      .body as Page<PaymentView>;
    expect(list.total).toBe(2);
    expect(list.items.map((payment) => payment.amount)).toEqual(['400.00', '600.00']);

    const events = await eventsOf(order.id);
    expect(events.filter((event) => event.type === 'PAYMENT_RECORDED')).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('Receipt 12');
  });

  it('refuses an overpayment (PAYMENT_EXCEEDS_BALANCE) and writes nothing', async () => {
    const order = await createOrder();
    await pay(order.id, { amount: '700' }).expect(201);
    const body = await refused(pay(order.id, { amount: '300.01' }));
    expect(body).toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      fieldErrors: { amount: expect.any(String) },
    });
    expect(body.fieldErrors.amount).toContain('300.00');
    expect(await paymentRows(order.id)).toHaveLength(1);
    await pay(order.id, { amount: '300' }).expect(201);
  });

  it('allows backdating up to 90 days, not more, not the future', async () => {
    const order = await createOrder();
    const occurredAt = new Date(Date.now() - 89 * DAY).toISOString();
    const res = (await pay(order.id, { amount: '100', occurredAt }).expect(201))
      .body as PaymentRecorded;
    expect(res.payment.occurredAt).toBe(occurredAt);
    expect(new Date(res.payment.createdAt).getTime()).toBeGreaterThan(Date.now() - DAY);

    for (const when of [new Date(Date.now() - 91 * DAY), new Date(Date.now() + DAY)]) {
      const body = await refused(
        pay(order.id, { amount: '100', occurredAt: when.toISOString() }),
        400,
      );
      expect(Object.keys(body.fieldErrors)).toEqual(['occurredAt']);
    }
  });

  it('refuses COD by hand: COD money is recorded by settling it', async () => {
    const order = await createOrder();
    const body = await refused(pay(order.id, { amount: '100', method: 'COD' }), 400);
    expect(Object.keys(body.fieldErrors)).toEqual(['method']);
  });
});

describe('refunds (§7.7)', () => {
  it('may not exceed the net paid (REFUND_EXCEEDS_PAID); part and full refunds set the status', async () => {
    const order = await createOrder();
    const paid = (await pay(order.id, { amount: '1000' }).expect(201)).body as PaymentRecorded;

    const body = await refused(refund(order.id, { amount: '1000.01' }));
    expect(body.code).toBe('REFUND_EXCEEDS_PAID');

    const part = (
      await refund(order.id, { amount: '250', refundOfPaymentId: paid.payment.id }).expect(201)
    ).body as PaymentRecorded;
    expect(part.payment).toMatchObject({ type: 'REFUND', refundOfPaymentId: paid.payment.id });
    expect(part.order).toMatchObject({
      amountRefunded: '250.00',
      paymentStatus: 'PARTIALLY_REFUNDED',
    });

    expect((await refused(refund(order.id, { amount: '750.01' }))).code).toBe(
      'REFUND_EXCEEDS_PAID',
    );
    const all = (await refund(order.id, { amount: '750' }).expect(201)).body as PaymentRecorded;
    expect(all.order).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect(
      (await eventsOf(order.id)).filter((event) => event.type === 'REFUND_RECORDED'),
    ).toHaveLength(2);
  });

  it('a refund points only at a payment of the same order', async () => {
    const order = await createOrder();
    const other = await createOrder();
    const otherPayment = (await pay(other.id, { amount: '100' }).expect(201))
      .body as PaymentRecorded;
    await pay(order.id, { amount: '500' }).expect(201);
    const firstRefund = (await refund(order.id, { amount: '10' }).expect(201))
      .body as PaymentRecorded;

    for (const target of [otherPayment.payment.id, firstRefund.payment.id, randomUUID()]) {
      const body = await refused(refund(order.id, { amount: '10', refundOfPaymentId: target }));
      expect(body).toMatchObject({
        code: 'REFUND_TARGET_INVALID',
        fieldErrors: { refundOfPaymentId: expect.any(String) },
      });
    }
  });

  it('a cancelled order takes no payments, but refunds what it holds', async () => {
    const order = await createOrder();
    await pay(order.id, { amount: '300' }).expect(201);
    await request(server)
      .post(`${O}/${order.id}/cancel`)
      .set(auth())
      .send({ reason: 'Changed mind' })
      .expect(200);

    expect((await refused(pay(order.id, { amount: '1' }))).code).toBe('ORDER_CLOSED');
    const res = (await refund(order.id, { amount: '300', notes: 'Correction' }).expect(201))
      .body as PaymentRecorded;
    expect(res.order).toMatchObject({
      orderStatus: 'CANCELLED',
      refundOwed: '0.00',
      paymentStatus: 'REFUNDED',
    });
  });
});

describe('cash on delivery (§7.8)', () => {
  it('before dispatch, a payment shrinks the COD amount; paying it all makes COD not applicable', async () => {
    const order = await codOrder();
    expect(order.delivery).toMatchObject({ codAmount: '1000.00', codStatus: 'PENDING' });

    const part = (await pay(order.id, { amount: '300', method: 'BANK_TRANSFER' }).expect(201))
      .body as PaymentRecorded;
    expect(part.order.delivery).toMatchObject({ codAmount: '700.00', codStatus: 'PENDING' });

    const rest = (await pay(order.id, { amount: '700' }).expect(201)).body as PaymentRecorded;
    expect(rest.order.delivery).toMatchObject({ codAmount: '0.00', codStatus: 'NOT_APPLICABLE' });
    expect(rest.order.paymentStatus).toBe('PAID');
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: 'COD_STATUS_CHANGED',
      oldValue: { codStatus: 'PENDING' },
      newValue: { codStatus: 'NOT_APPLICABLE' },
    });
  });

  it('after dispatch the COD amount is frozen: a payment may not cover the COD still to come', async () => {
    const order = await codOrder();
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: 'READY' } });
    await prisma.delivery.update({ where: { orderId: order.id }, data: { status: 'DISPATCHED' } });

    expect((await refused(pay(order.id, { amount: '1' }))).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(delivery.codAmount.toFixed(2)).toBe('1000.00');
  });
});

describe('records are insert-only and requests are safe to retry', () => {
  it('needs an Idempotency-Key; a retry with the same key records the payment once', async () => {
    const order = await createOrder();
    await request(server)
      .post(`${O}/${order.id}/payments`)
      .set(auth())
      .send({ type: 'PAYMENT', method: 'CASH', amount: '100' })
      .expect(400);

    const key = randomUUID();
    const first = await pay(order.id, { amount: '100' }, key).expect(201);
    const again = await pay(order.id, { amount: '100' }, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await paymentRows(order.id)).toHaveLength(1);
    // The same key with another body is a different request.
    await pay(order.id, { amount: '200' }, key).expect(409);
  });

  it('offers no way to change or delete a record', async () => {
    const order = await createOrder();
    const recorded = (await pay(order.id, { amount: '100' }).expect(201)).body as PaymentRecorded;
    const path = `${O}/${order.id}/payments/${recorded.payment.id}`;
    await request(server).patch(path).set(auth()).send({ amount: '1' }).expect(404);
    await request(server).delete(path).set(auth()).expect(404);
    await request(server).put(path).set(auth()).send({ amount: '1' }).expect(404);
    expect((await paymentRows(order.id))[0]?.amount.toFixed(2)).toBe('100.00');
  });

  it("another business's order is a 404 for listing and recording", async () => {
    const order = await createOrder();
    await request(server).get(`${O}/${order.id}/payments`).set(auth(tenants.b)).expect(404);
    await pay(order.id, { amount: '1' }, randomUUID(), tenants.b).expect(404);
    expect(await paymentRows(order.id)).toHaveLength(0);
  });
});
