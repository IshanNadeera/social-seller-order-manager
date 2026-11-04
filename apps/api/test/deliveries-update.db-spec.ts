// PATCH /orders/:id/delivery against the real database (docs/DEVELOPMENT.md §9.4, §7.4, §7.8, task D2).
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
const ADDRESS = {
  recipientName: 'Ship Demo',
  phone: '0771234567',
  addressLine1: '1 Ship Road',
  city: 'Kandy',
};

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let customerId: string;
let addressId: string;

const auth = (tenant: Tenant = tenants.a) => ({ Authorization: `Bearer ${tenant.token}` });

/** A 1000.00 COD delivery order (no fee), copied from the customer's saved address. */
async function createOrder(extra: object = {}): Promise<OrderDetail> {
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
      delivery: { ...ADDRESS, sourceAddressId: addressId },
      ...extra,
    })
    .expect(201);
  return res.body as OrderDetail;
}

const patch = (orderId: string, body: object, tenant: Tenant = tenants.a) =>
  request(server).patch(`${O}/${orderId}/delivery`).set(auth(tenant)).send(body);

async function refused(res: ReturnType<typeof patch>, status = 422) {
  return (await res.expect(status)).body as { code: string; fieldErrors: Record<string, string> };
}

/** Moves the delivery on directly (the actions themselves are D3). */
async function setDelivery(
  orderId: string,
  status: 'DISPATCHED' | 'DELIVERED' | 'RETURNED',
  orderStatus: 'READY' | 'COMPLETED' | 'RETURNED',
) {
  await prisma.order.update({ where: { id: orderId }, data: { orderStatus } });
  await prisma.delivery.update({ where: { orderId }, data: { status } });
}

const eventsOf = (orderId: string) =>
  prisma.orderEvent.findMany({
    where: { businessId: tenants.a.businessId, orderId, type: { not: 'ORDER_CREATED' } },
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
  const customer = await prisma.customer.create({
    data: {
      businessId: tenants.a.businessId,
      name: 'Ship Demo',
      addresses: { create: { ...ADDRESS, isDefault: true } },
    },
    include: { addresses: true },
  });
  customerId = customer.id;
  addressId = customer.addresses[0]?.id ?? '';
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('before dispatch (§7.4)', () => {
  it('edits the recipient and address; the copy is no longer linked to the saved address; logged without the text', async () => {
    const order = await createOrder();
    const res = await patch(order.id, {
      addressLine1: '5 Temple Street',
      city: '',
      district: 'kandy',
    }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as OrderDetail).delivery).toMatchObject({
      addressLine1: '5 Temple Street',
      city: null,
      district: 'Kandy',
      recipientName: 'Ship Demo',
    });
    const row = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(row.sourceAddressId).toBeNull();
    // The customer's saved address is untouched (§7.11).
    expect(
      (await prisma.customerAddress.findUniqueOrThrow({ where: { id: addressId } })).addressLine1,
    ).toBe('1 Ship Road');
    const events = await eventsOf(order.id);
    expect(events).toMatchObject([
      {
        type: 'ORDER_UPDATED',
        newValue: { deliveryAddressChanged: ['addressLine1', 'city', 'district'] },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Temple');
  });

  it('sets the COD amount between 0 and the balance due; 0 makes COD not applicable', async () => {
    const order = await createOrder({ initialPayment: { amount: '200', method: 'CASH' } });
    expect(order.delivery).toMatchObject({ codAmount: '800.00', codStatus: 'PENDING' });

    const body = await refused(patch(order.id, { codAmount: '800.01' }));
    expect(body).toMatchObject({
      code: 'COD_EXCEEDS_BALANCE',
      fieldErrors: { codAmount: expect.any(String) },
    });
    expect(body.fieldErrors.codAmount).toContain('800.00');

    const lower = (await patch(order.id, { codAmount: '500' }).expect(200)).body as OrderDetail;
    expect(lower.delivery).toMatchObject({ codAmount: '500.00', codStatus: 'PENDING' });

    const none = (await patch(order.id, { codAmount: '0' }).expect(200)).body as OrderDetail;
    expect(none.delivery).toMatchObject({ codAmount: '0.00', codStatus: 'NOT_APPLICABLE' });
    expect((await eventsOf(order.id)).slice(-2)).toMatchObject([
      { type: 'ORDER_UPDATED', oldValue: { codAmount: '500.00' }, newValue: { codAmount: '0.00' } },
      {
        type: 'COD_STATUS_CHANGED',
        oldValue: { codStatus: 'PENDING' },
        newValue: { codStatus: 'NOT_APPLICABLE' },
      },
    ]);

    const back = (await patch(order.id, { codAmount: '800' }).expect(200)).body as OrderDetail;
    expect(back.delivery).toMatchObject({ codAmount: '800.00', codStatus: 'PENDING' });
  });

  it('a COD amount only on a COD order', async () => {
    const order = await createOrder({ paymentMethod: 'CASH' });
    expect((await refused(patch(order.id, { codAmount: '100' }))).code).toBe('NOT_A_COD_ORDER');
  });
});

describe('after dispatch', () => {
  it('address and COD are locked; courier, tracking and notes still change', async () => {
    const order = await createOrder();
    await setDelivery(order.id, 'DISPATCHED', 'READY');

    expect(await refused(patch(order.id, { addressLine1: '9 Late Lane' }))).toMatchObject({
      code: 'ORDER_LOCKED_AFTER_DISPATCH',
      fieldErrors: { addressLine1: expect.any(String) },
    });
    expect(await refused(patch(order.id, { codAmount: '10' }))).toMatchObject({
      code: 'ORDER_LOCKED_AFTER_DISPATCH',
      fieldErrors: { codAmount: expect.any(String) },
    });

    const res = (
      await patch(order.id, {
        courierName: 'Domex',
        trackingNumber: 'DX123',
        notes: 'Fragile',
      }).expect(200)
    ).body as OrderDetail;
    expect(res.delivery).toMatchObject({
      courierName: 'Domex',
      trackingNumber: 'DX123',
      codAmount: '1000.00',
    });
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: 'ORDER_UPDATED',
      oldValue: { courierName: null, trackingNumber: null },
      newValue: { courierName: 'Domex', trackingNumber: 'DX123', deliveryNotesChanged: true },
    });
  });

  it('courier details stay editable after delivery, not after a return', async () => {
    const order = await createOrder();
    await setDelivery(order.id, 'DELIVERED', 'COMPLETED');
    await patch(order.id, { trackingNumber: 'DX999' }).expect(200);

    await setDelivery(order.id, 'RETURNED', 'RETURNED');
    expect((await refused(patch(order.id, { trackingNumber: 'DX000' }))).code).toBe(
      'ORDER_LOCKED_AFTER_DISPATCH',
    );
    // Notes are always allowed.
    await patch(order.id, { notes: 'Returned: wrong address' }).expect(200);
  });

  it('resending unchanged values is harmless: no lock error and no event', async () => {
    const order = await createOrder();
    await setDelivery(order.id, 'DISPATCHED', 'READY');
    const before = (await eventsOf(order.id)).length;
    await patch(order.id, { addressLine1: '1 Ship Road', codAmount: '1000.00' }).expect(200);
    expect(await eventsOf(order.id)).toHaveLength(before);
  });
});

describe('requests', () => {
  it('a pickup order has no delivery to edit', async () => {
    const order = await createOrder({
      fulfilmentType: 'PICKUP',
      paymentMethod: 'CASH',
      delivery: undefined,
    });
    expect((await refused(patch(order.id, { notes: 'x' }))).code).toBe('NOT_A_DELIVERY_ORDER');
  });

  it('refuses statuses, the saved-address link and an empty edit (400)', async () => {
    const order = await createOrder();
    const res = await patch(order.id, {
      status: 'DELIVERED',
      codStatus: 'SETTLED',
      sourceAddressId: addressId,
    }).expect(400);
    expect(
      Object.keys((res.body as { fieldErrors: Record<string, string> }).fieldErrors).sort(),
    ).toEqual(['codStatus', 'sourceAddressId', 'status']);
    await patch(order.id, {}).expect(400);
  });

  it("another business's order, an unknown ID and a non-UUID are 404", async () => {
    const order = await createOrder();
    await patch(order.id, { notes: 'x' }, tenants.b).expect(404);
    await patch(randomUUID(), { notes: 'x' }).expect(404);
    await patch('not-a-uuid', { notes: 'x' }).expect(404);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).notes,
    ).toBeNull();
  });
});
