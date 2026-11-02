// POST /orders against the real database (docs/DEVELOPMENT.md §7.8, §7.10, §9.6, task C8).
// Run with: npm run test:db -w apps/api. Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MAX_ACTIVE_ADDRESSES } from '@ssom/shared';
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
let archivedProductId: string;
let productOfB: string;

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
  archivedProductId = (
    await prisma.product.create({
      data: { businessId: a, name: 'Old Item', sellingPrice: '10.00', archivedAt: new Date() },
    })
  ).id;
  productOfB = (
    await prisma.product.create({
      data: { businessId: tenants.b.businessId, name: 'B Item', sellingPrice: '10.00' },
    })
  ).id;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

const create = (body: object, key: string = randomUUID(), tenant: Tenant = tenants.a) =>
  request(server)
    .post(PATH)
    .set('Authorization', `Bearer ${tenant.token}`)
    .set('Idempotency-Key', key)
    .send(body);

/** §9.6's example order: 2 saree + gift wrap, discount 100, COD delivery. */
const codOrder = (extra: object = {}) => ({
  sourceChannel: 'WHATSAPP',
  customerId,
  items: [
    { productId, quantity: 2 },
    { name: 'Gift wrapping', quantity: 1, unitPrice: '200.00' },
  ],
  discountAmount: '100.00',
  paymentMethod: 'COD',
  delivery: ADDRESS,
  notes: 'Deliver on Saturday',
  ...extra,
});

const orderCount = () => prisma.order.count({ where: { businessId: tenants.a.businessId } });
const counter = () =>
  prisma.businessCounter.findUniqueOrThrow({ where: { businessId: tenants.a.businessId } });

describe('POST /orders: the §9.6 steps', () => {
  it('creates the order, lines, delivery and ORDER_CREATED event, with server totals', async () => {
    const res = await create(codOrder()).expect(201);
    const order = res.body as OrderDetail;
    expect(order).toMatchObject({
      orderNumber: 'TNA-0001',
      orderStatus: 'NEW',
      paymentStatus: 'UNPAID',
      stage: 'NEW',
      customer: { id: customerId, name: 'Nimali Demo', phone: '077 123 4567' },
      subtotal: '3200.00',
      discountAmount: '100.00',
      deliveryFee: '350.00', // the business default
      totalAmount: '3450.00',
      amountPaid: '0.00',
      balanceDue: '3450.00',
      delivery: {
        status: 'PENDING',
        recipientName: 'Nimali Demo',
        codAmount: '3450.00', // defaults to the balance due
        codStatus: 'PENDING',
      },
      notes: 'Deliver on Saturday',
    });
    expect(order.items).toEqual([
      expect.objectContaining({
        productId,
        name: 'Silk Saree',
        sku: 'SAR-1',
        quantity: 2,
        unitPrice: '1500.00',
        lineTotal: '3000.00',
      }),
      expect.objectContaining({
        productId: null,
        name: 'Gift wrapping',
        sku: null,
        unitPrice: '200.00',
        lineTotal: '200.00',
      }),
    ]);
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events.map((event) => event.type)).toEqual(['ORDER_CREATED']);
    expect(JSON.stringify(events[0]?.newValue)).not.toContain('0771234567'); // no personal data
  });

  it('takes an advance: COD defaults to what is left, and the payment is recorded', async () => {
    const res = await create(
      codOrder({ initialPayment: { amount: '1000.00', method: 'BANK_TRANSFER' } }),
    ).expect(201);
    const order = res.body as OrderDetail;
    expect(order).toMatchObject({
      totalAmount: '3450.00',
      amountPaid: '1000.00',
      paymentStatus: 'PARTIALLY_PAID',
      balanceDue: '2450.00',
      delivery: { codAmount: '2450.00', codStatus: 'PENDING' },
    });
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((event) => event.type)).toEqual(['ORDER_CREATED', 'PAYMENT_RECORDED']);
  });

  it('uses a price override for a product, but always the product’s own name and SKU', async () => {
    const res = await create(
      codOrder({
        items: [{ productId, quantity: 1, unitPrice: '1400.00' }],
        paymentMethod: 'CASH',
      }),
    ).expect(201);
    expect((res.body as OrderDetail).items[0]).toMatchObject({
      name: 'Silk Saree',
      unitPrice: '1400.00',
    });
    expect((res.body as OrderDetail).delivery).toMatchObject({
      codAmount: '0.00',
      codStatus: 'NOT_APPLICABLE',
    });
  });
});

describe('client totals and business IDs are refused (§9.6 step 3)', () => {
  it.each(['subtotal', 'totalAmount', 'businessId', 'paymentStatus'])('%s', async (field) => {
    const before = await orderCount();
    const res = await create(codOrder({ [field]: '1.00' })).expect(400);
    expect(res.body).toMatchObject({ fieldErrors: { [field]: 'This field is not allowed.' } });
    expect(await orderCount()).toBe(before);
  });

  it('a lineTotal on an item', async () => {
    const res = await create(
      codOrder({ items: [{ productId, quantity: 1, lineTotal: '1.00' }] }),
    ).expect(400);
    expect(res.body).toMatchObject({
      fieldErrors: { 'items[0].lineTotal': 'This field is not allowed.' },
    });
  });
});

describe('walk-in sales (§7.10)', () => {
  const walkIn = (extra: object = {}) => ({
    sourceChannel: 'WALK_IN',
    fulfilmentType: 'PICKUP',
    items: [{ name: 'Tea', quantity: 2, unitPrice: '50.00' }],
    paymentMethod: 'CASH',
    initialPayment: { amount: '100.00' },
    ...extra,
  });

  it('an anonymous pickup sale needs no customer', async () => {
    const res = await create(walkIn()).expect(201);
    expect(res.body).toMatchObject({
      customer: { id: null, name: 'Walk-in customer', phone: null },
      deliveryFee: '0.00',
      totalAmount: '100.00',
      paymentStatus: 'PAID',
      delivery: null,
    });
  });

  it('without a customer it must be a walk-in, and a pickup', async () => {
    const delivery = await create(walkIn({ fulfilmentType: 'DELIVERY', delivery: ADDRESS })).expect(
      400,
    );
    expect(delivery.body).toMatchObject({
      fieldErrors: { fulfilmentType: 'An order without a customer must be a pickup.' },
    });
    const whatsapp = await create(walkIn({ sourceChannel: 'WHATSAPP' })).expect(400);
    expect(whatsapp.body).toMatchObject({ fieldErrors: { customerId: 'Choose a customer.' } });
  });
});

describe('business rules (422)', () => {
  it('a discount above the subtotal', async () => {
    const res = await create(codOrder({ discountAmount: '5000.00' })).expect(422);
    expect(res.body).toMatchObject({
      code: 'DISCOUNT_EXCEEDS_SUBTOTAL',
      fieldErrors: { discountAmount: expect.any(String) as string },
    });
  });

  it('an advance above the total, or a COD amount above the balance', async () => {
    const advance = await create(
      codOrder({ initialPayment: { amount: '9999.00', method: 'CASH' } }),
    ).expect(422);
    expect(advance.body).toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
    const cod = await create(codOrder({ delivery: { ...ADDRESS, codAmount: '3450.01' } })).expect(
      422,
    );
    expect(cod.body).toMatchObject({ code: 'COD_EXCEEDS_BALANCE' });
  });

  it.each([
    ['an archived product', () => archivedProductId],
    ['another business’s product', () => productOfB],
  ])('%s is not available', async (_name, id) => {
    const res = await create(codOrder({ items: [{ productId: id(), quantity: 1 }] })).expect(422);
    expect(res.body).toMatchObject({
      code: 'PRODUCT_NOT_AVAILABLE',
      fieldErrors: { 'items[0].productId': expect.any(String) as string },
    });
  });

  it("another business's customer gets the standard 404", async () => {
    const ofB = await prisma.customer.create({
      data: { businessId: tenants.b.businessId, name: 'B Demo' },
    });
    const res = await create(codOrder({ customerId: ofB.id })).expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('one transaction', () => {
  it('a failure after the order was inserted leaves no order, no number used, no key kept', async () => {
    // Fill the customer's addresses, so "save address to customer" fails after the order insert.
    const full = await prisma.customer.create({
      data: { businessId: tenants.a.businessId, name: 'Full Demo' },
    });
    await prisma.customerAddress.createMany({
      data: Array.from({ length: MAX_ACTIVE_ADDRESSES }, (_, index) => ({
        businessId: tenants.a.businessId,
        customerId: full.id,
        recipientName: 'Full Demo',
        phone: '0770000000',
        addressLine1: `${index + 1} Full Road`,
        isDefault: index === 0,
      })),
    });
    const ordersBefore = await orderCount();
    const { nextOrderSeq } = await counter();
    const key = randomUUID();

    const res = await create(
      codOrder({ customerId: full.id, delivery: { ...ADDRESS, saveToCustomer: true } }),
      key,
    ).expect(422);
    expect(res.body).toMatchObject({ code: 'ADDRESS_LIMIT_REACHED' });

    expect(await orderCount()).toBe(ordersBefore);
    expect((await counter()).nextOrderSeq).toBe(nextOrderSeq);
    expect(
      await prisma.idempotencyKey.count({ where: { businessId: tenants.a.businessId, key } }),
    ).toBe(0);
  });

  it('saves a new address to the customer when asked, as the default if they had none', async () => {
    await create(codOrder({ delivery: { ...ADDRESS, saveToCustomer: true } })).expect(201);
    const saved = await prisma.customerAddress.findMany({ where: { customerId } });
    expect(saved).toEqual([
      expect.objectContaining({ addressLine1: '1 Lake Road', isDefault: true }),
    ]);
  });
});

describe('Idempotency-Key (§9.8)', () => {
  it('is required', async () => {
    const res = await request(server)
      .post(PATH)
      .set('Authorization', `Bearer ${tenants.a.token}`)
      .send(codOrder())
      .expect(400);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('a retry returns the same order and creates nothing new', async () => {
    const key = randomUUID();
    const first = await create(codOrder(), key).expect(201);
    const before = await orderCount();
    const retry = await create(codOrder(), key).expect(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await orderCount()).toBe(before);
  });
});
