// PATCH /orders/:id against the real database (docs/DEVELOPMENT.md §7.4, §7.5, §7.8, task C11).
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

const PATH = '/api/v1/orders';
const ADDRESS = {
  recipientName: 'Nimali Demo',
  phone: '0771234567',
  addressLine1: '1 Lake Road',
  city: 'Kandy',
  district: 'Kandy',
};

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;
let productId: string;

/** A delivery order of 2 × 1500 + fee 350 = 3350, with optional extras. */
async function createOrder(extra: object = {}): Promise<OrderDetail> {
  const res = await request(server)
    .post(PATH)
    .set('Authorization', `Bearer ${tenants.a.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      sourceChannel: 'WHATSAPP',
      customerId,
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'CASH',
      delivery: ADDRESS,
      ...extra,
    })
    .expect(201);
  return res.body as OrderDetail;
}

const patch = (id: string, body: object, tenant: Tenant = tenants.a) =>
  request(server).patch(`${PATH}/${id}`).set('Authorization', `Bearer ${tenant.token}`).send(body);

/** The 422 code and field errors of a refused edit. */
async function refused(id: string, body: object) {
  const res = await patch(id, body).expect(422);
  return res.body as { code: string; fieldErrors: Record<string, string> };
}

const eventsOf = (orderId: string) =>
  prisma.orderEvent.findMany({
    where: { businessId: tenants.a.businessId, orderId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, oldValue: true, newValue: true },
  });

beforeAll(async () => {
  const env = parseEnv(process.env);
  const auth = await createTestAuth(env.SUPABASE_JWT_ISSUER);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(JWKS)
    .useValue(auth.jwks)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, env);
  await app.init();
  server = app.getHttpServer();
  prisma = moduleRef.get(PrismaService);
  tenants = await createTwoTenants(prisma, auth);

  const a = tenants.a.businessId;
  await prisma.business.update({ where: { id: a }, data: { defaultDeliveryFee: '350.00' } });
  customerId = (
    await prisma.customer.create({
      data: { businessId: a, name: 'Nimali Demo', phoneDisplay: '077 123 4567' },
    })
  ).id;
  productId = (
    await prisma.product.create({
      data: { businessId: a, name: 'Silk Saree', sku: 'SAR-1', sellingPrice: '1500.00' },
    })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('PATCH /orders/:id: money', () => {
  it('replaces items and recalculates totals and the payment summary in the same transaction', async () => {
    const order = await createOrder({ initialPayment: { amount: '1000.00' } });
    expect(order).toMatchObject({ totalAmount: '3350.00', paymentStatus: 'PARTIALLY_PAID' });

    const res = await patch(order.id, {
      items: [{ productId, quantity: 1 }, { name: 'Gift wrapping', quantity: 1, unitPrice: '200' }],
    }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const edited = res.body as OrderDetail;
    expect(edited.items.map((item) => [item.name, item.lineTotal])).toEqual([
      ['Silk Saree', '1500.00'],
      ['Gift wrapping', '200.00'],
    ]);
    expect(edited).toMatchObject({
      subtotal: '1700.00',
      totalAmount: '2050.00',
      amountPaid: '1000.00',
      balanceDue: '1050.00',
      paymentStatus: 'PARTIALLY_PAID',
    });

    // A discount that brings the total down to what was paid makes the order PAID.
    const paid = (await patch(order.id, { discountAmount: '1050' }).expect(200)).body as OrderDetail;
    expect(paid).toMatchObject({ totalAmount: '1000.00', balanceDue: '0.00', paymentStatus: 'PAID' });

    const events = await eventsOf(order.id);
    expect(events.map((event) => event.type)).toEqual([
      'ORDER_CREATED',
      'PAYMENT_RECORDED',
      'ORDER_UPDATED',
      'ORDER_UPDATED',
    ]);
    expect(events[2]).toMatchObject({
      oldValue: { totalAmount: '3350.00', items: [{ name: 'Silk Saree', quantity: 2 }] },
      newValue: { totalAmount: '2050.00', subtotal: '1700.00' },
    });
  });

  it('refuses a total below the net amount paid (ORDER_TOTAL_BELOW_PAID) and changes nothing', async () => {
    const order = await createOrder({ initialPayment: { amount: '3000.00' } });
    const body = await refused(order.id, { items: [{ productId, quantity: 1 }] });
    expect(body.code).toBe('ORDER_TOTAL_BELOW_PAID');
    expect(body.fieldErrors).toHaveProperty('items');
    const after = (await request(server)
      .get(`${PATH}/${order.id}`)
      .set('Authorization', `Bearer ${tenants.a.token}`)
      .expect(200)).body as OrderDetail;
    expect(after).toEqual(order);
    expect((await eventsOf(order.id)).map((event) => event.type)).not.toContain('ORDER_UPDATED');
  });

  it('keeps the COD amount equal to the balance due', async () => {
    const order = await createOrder({ paymentMethod: 'COD' });
    expect(order.delivery).toMatchObject({ codAmount: '3350.00', codStatus: 'PENDING' });
    const edited = (await patch(order.id, { deliveryFee: '500' }).expect(200)).body as OrderDetail;
    expect(edited.totalAmount).toBe('3500.00');
    expect(edited.delivery).toMatchObject({ codAmount: '3500.00', codStatus: 'PENDING' });
  });
});

describe('PATCH /orders/:id: switching fulfilment', () => {
  it('to pickup: a COD order needs another payment method; the delivery row and fee go, with an event', async () => {
    const order = await createOrder({ paymentMethod: 'COD' });
    expect((await refused(order.id, { fulfilmentType: 'PICKUP' })).code).toBe('COD_NEEDS_DELIVERY');

    const edited = (await patch(order.id, { fulfilmentType: 'PICKUP', paymentMethod: 'CASH' }).expect(200))
      .body as OrderDetail;
    expect(edited).toMatchObject({
      fulfilmentType: 'PICKUP',
      paymentMethod: 'CASH',
      deliveryFee: '0.00',
      totalAmount: '3000.00',
      delivery: null,
    });
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(0);
    const last = (await eventsOf(order.id)).at(-1);
    expect(last).toMatchObject({
      type: 'ORDER_UPDATED',
      oldValue: { fulfilmentType: 'DELIVERY', paymentMethod: 'COD', deliveryFee: '350.00' },
      newValue: { fulfilmentType: 'PICKUP', paymentMethod: 'CASH', deliveryFee: '0.00', delivery: 'REMOVED' },
    });
  });

  it('to delivery: needs the address; creates the delivery row with the default fee and COD', async () => {
    const order = await createOrder({ fulfilmentType: 'PICKUP', delivery: undefined });
    expect(order).toMatchObject({ totalAmount: '3000.00', delivery: null });
    expect((await refused(order.id, { fulfilmentType: 'DELIVERY' })).code).toBe(
      'DELIVERY_ADDRESS_REQUIRED',
    );

    const edited = (
      await patch(order.id, { fulfilmentType: 'DELIVERY', paymentMethod: 'COD', delivery: ADDRESS }).expect(200)
    ).body as OrderDetail;
    expect(edited).toMatchObject({ deliveryFee: '350.00', totalAmount: '3350.00' });
    expect(edited.delivery).toMatchObject({
      status: 'PENDING',
      recipientName: 'Nimali Demo',
      codAmount: '3350.00',
      codStatus: 'PENDING',
    });
    const events = await eventsOf(order.id);
    expect(events.slice(-2)).toMatchObject([
      { type: 'ORDER_UPDATED', newValue: { fulfilmentType: 'DELIVERY', delivery: 'CREATED' } },
      { type: 'COD_STATUS_CHANGED', oldValue: { codStatus: 'NOT_APPLICABLE' }, newValue: { codStatus: 'PENDING' } },
    ]);
    // No address in the history (§8.2).
    expect(JSON.stringify(events)).not.toContain('Lake Road');
  });

  it('an order without a customer stays a pickup', async () => {
    const order = await createOrder({
      sourceChannel: 'WALK_IN',
      customerId: null,
      fulfilmentType: 'PICKUP',
      delivery: undefined,
    });
    expect(
      (await refused(order.id, { fulfilmentType: 'DELIVERY', delivery: ADDRESS })).code,
    ).toBe('CUSTOMER_REQUIRED');
  });

  it('the address of an existing delivery is changed elsewhere', async () => {
    const order = await createOrder();
    expect((await refused(order.id, { fulfilmentType: 'DELIVERY', delivery: ADDRESS })).code).toBe(
      'DELIVERY_EXISTS',
    );
  });
});

describe('PATCH /orders/:id: edit-lock rules (§7.4)', () => {
  it('after dispatch: money and fulfilment are locked; notes and source still change', async () => {
    const order = await createOrder();
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: 'READY' } });
    await prisma.delivery.update({ where: { orderId: order.id }, data: { status: 'DISPATCHED' } });

    expect((await refused(order.id, { discountAmount: '10' })).code).toBe('ORDER_LOCKED_AFTER_DISPATCH');
    expect((await refused(order.id, { fulfilmentType: 'PICKUP' })).code).toBe('ORDER_LOCKED_AFTER_DISPATCH');
    await patch(order.id, { notes: 'Call before arriving' }).expect(200);
    const edited = (await patch(order.id, { sourceChannel: 'FACEBOOK' }).expect(200)).body as OrderDetail;
    expect(edited).toMatchObject({ sourceChannel: 'FACEBOOK', notes: 'Call before arriving' });
  });

  it('a finished order: only notes change', async () => {
    const order = await createOrder();
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: 'CANCELLED' } });
    expect((await refused(order.id, { sourceChannel: 'FACEBOOK' })).code).toBe('ORDER_CLOSED');
    expect((await refused(order.id, { discountAmount: '10' })).code).toBe('ORDER_CLOSED');
    await patch(order.id, { notes: 'Customer changed their mind' }).expect(200);
  });

  it('resending unchanged values is harmless: no lock error and no event', async () => {
    const order = await createOrder();
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: 'CANCELLED' } });
    const before = (await eventsOf(order.id)).length;
    await patch(order.id, { sourceChannel: 'WHATSAPP', deliveryFee: '350.00' }).expect(200);
    expect(await eventsOf(order.id)).toHaveLength(before);
  });

  it('needs a note when the source becomes OTHER', async () => {
    const order = await createOrder();
    expect((await refused(order.id, { sourceChannel: 'OTHER' })).code).toBe('SOURCE_NOTE_REQUIRED');
    await patch(order.id, { sourceChannel: 'OTHER', sourceNote: 'Market stall' }).expect(200);
  });
});

describe('PATCH /orders/:id: requests', () => {
  it("answers 404 for another business's order, an unknown ID and a non-UUID", async () => {
    const order = await createOrder();
    await patch(order.id, { notes: 'x' }, tenants.b).expect(404);
    await patch(randomUUID(), { notes: 'x' }).expect(404);
    await patch('not-a-uuid', { notes: 'x' }).expect(404);
  });

  it('refuses an empty edit, client totals and business IDs (400)', async () => {
    const order = await createOrder();
    await patch(order.id, {}).expect(400);
    const res = await patch(order.id, { totalAmount: '1.00', businessId: tenants.b.businessId }).expect(400);
    expect((res.body as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({
      totalAmount: 'This field is not allowed.',
      businessId: 'This field is not allowed.',
    });
  });

  it("refuses another business's product", async () => {
    const order = await createOrder();
    const other = await prisma.product.create({
      data: { businessId: tenants.b.businessId, name: 'B Item', sellingPrice: '10.00' },
    });
    expect((await refused(order.id, { items: [{ productId: other.id, quantity: 1 }] })).code).toBe(
      'PRODUCT_NOT_AVAILABLE',
    );
  });
});
