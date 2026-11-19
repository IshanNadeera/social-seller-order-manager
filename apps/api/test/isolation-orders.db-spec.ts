// Tenant isolation sweep for orders, payments, deliveries and COD (docs/DEVELOPMENT.md §11.1, §12.4,
// tasks C17 and D9). Business A attacks business B (and B attacks A) on every route that takes an
// order ID; lists must not leak; an order can't point at another business's customer, product or
// saved address; a client businessId is refused. Needs a migrated local database.
// Run with: npm run test:db -w apps/api
//
// A coverage guard at the end lists the routes the order, payment, delivery and COD controllers
// register. A new route fails it until it is added to this sweep.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import type { Type } from '@nestjs/common';
// Nest's own decorator metadata keys, read only by the coverage guard below.
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type {
  CodAwaitingItem,
  CustomerDetail,
  OrderDetail,
  OrderSummary,
  Page,
  ProductView,
} from '@ssom/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { DeliveriesController } from '../src/deliveries/deliveries.controller';
import { OrdersController } from '../src/orders/orders.controller';
import { CodBulkController } from '../src/payments/cod-bulk.controller';
import { CodController } from '../src/payments/cod.controller';
import { PaymentsController } from '../src/payments/payments.controller';
import { createTestAuth } from './test-auth';
import {
  callRoute,
  createTwoTenants,
  expectCrossTenant404,
  withoutRequestId,
} from './tenant-isolation';
import type { RouteUnderTest, Tenant, TwoTenants } from './tenant-isolation';

// Fake people, numbers and products only.
const ADDRESS = { recipientName: 'Iso Demo', phone: '0770000001', addressLine1: '1 Iso Road' };
const O = '/api/v1/orders';

/** The records one business owns, as seen by the sweep. */
interface Owned {
  tenant: Tenant;
  customer: string;
  address: string;
  product: string;
  /** A NEW delivery order (COD), so every write route would succeed for its owner. */
  order: string;
  orderNumber: string;
  /** A cancelled order: closed records must be just as invisible. */
  cancelledOrder: string;
}

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let a: Owned;
let b: Owned;

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });

/** A valid POST /orders body for `owner`'s own customer and product, with `changes` on top. */
const orderBody = (owner: { customer: string; product: string }, changes: object = {}) => ({
  sourceChannel: 'WHATSAPP',
  customerId: owner.customer,
  items: [{ productId: owner.product, quantity: 1 }],
  paymentMethod: 'COD',
  delivery: ADDRESS,
  ...changes,
});

const createOrder = (tenant: Tenant, body: object) =>
  request(server).post(O).set(as(tenant)).set('Idempotency-Key', randomUUID()).send(body);

/** Creates the same set of records for one business through the API (as its own owner). */
async function seed(tenant: Tenant, label: string, phone: string, sku: string): Promise<Owned> {
  const post = async <Body>(path: string, body: object): Promise<Body> => {
    const res = await request(server).post(path).set(as(tenant)).send(body);
    expect(res.status, `seed POST ${path}`).toBeLessThan(300);
    return res.body as Body;
  };
  const customer = await post<CustomerDetail>('/api/v1/customers', {
    name: `${label} Customer`,
    phone,
    address: ADDRESS,
  });
  const product = await post<ProductView>('/api/v1/products', {
    name: `${label} Product`,
    sku,
    sellingPrice: '100',
  });
  const [address] = customer.addresses;
  if (address === undefined) throw new Error('seed: customer has no address');
  const owned = { tenant, customer: customer.id, address: address.id, product: product.id };

  const order = async () => {
    const res = await createOrder(tenant, orderBody(owned));
    expect(res.status, 'seed POST /orders').toBe(201);
    return res.body as OrderDetail;
  };
  const open = await order();
  const cancelled = await order();
  await post(`${O}/${cancelled.id}/cancel`, { reason: 'Seed' });
  return { ...owned, order: open.id, orderNumber: open.orderNumber, cancelledOrder: cancelled.id };
}

/** Everything business `owner` has in the order tables, to prove an attack changed nothing. */
async function snapshot(owner: Owned) {
  const where = { businessId: owner.tenant.businessId };
  const byId = { id: 'asc' as const };
  return {
    orders: await prisma.order.findMany({ where, orderBy: byId }),
    items: await prisma.orderItem.findMany({ where, orderBy: byId }),
    deliveries: await prisma.delivery.findMany({ where, orderBy: byId }),
    events: await prisma.orderEvent.findMany({ where, orderBy: byId }),
    payments: await prisma.payment.findMany({ where, orderBy: byId }),
    // "Save address to customer" must not reach the other business either.
    addresses: await prisma.customerAddress.findMany({ where, orderBy: byId }),
  };
}

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
  a = await seed(tenants.a, 'Alpha', '0771110001', 'ALPHA-1');
  b = await seed(tenants.b, 'Bravo', '0772220002', 'BRAVO-1');
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

// ---------- Routes that take an order ID ----------

interface Attack {
  /** The route as the controller declares it, for the coverage guard. */
  covers: string;
  name: string;
  route: RouteUnderTest;
  target: (victim: Owned) => string;
}

const attacks: Attack[] = (['order', 'cancelledOrder'] as const).flatMap((which): Attack[] => [
  {
    covers: 'GET /orders/:id',
    name: `read ${which}`,
    route: { method: 'get', path: (id) => `${O}/${id}` },
    target: (victim) => victim[which],
  },
  {
    covers: 'GET /orders/:id/events',
    name: `read the history of ${which}`,
    route: { method: 'get', path: (id) => `${O}/${id}/events` },
    target: (victim) => victim[which],
  },
  {
    covers: 'PATCH /orders/:id',
    name: `edit ${which}`,
    route: {
      method: 'patch',
      path: (id) => `${O}/${id}`,
      body: { notes: 'Taken', discountAmount: '1' },
    },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/status',
    name: `change the status of ${which}`,
    route: { method: 'post', path: (id) => `${O}/${id}/status`, body: { to: 'CONFIRMED' } },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/cancel',
    name: `cancel ${which}`,
    route: { method: 'post', path: (id) => `${O}/${id}/cancel`, body: { reason: 'Taken' } },
    target: (victim) => victim[which],
  },
  // Payments (§7.7) and COD settlement (§7.8): money routes, so each call carries a key.
  {
    covers: 'GET /orders/:id/payments',
    name: `read the payments of ${which}`,
    route: { method: 'get', path: (id) => `${O}/${id}/payments` },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/payments',
    name: `record a payment on ${which}`,
    route: {
      method: 'post',
      path: (id) => `${O}/${id}/payments`,
      body: { type: 'PAYMENT', method: 'CASH', amount: '1' },
      idempotent: true,
    },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/cod/settle',
    name: `settle the COD of ${which}`,
    route: { method: 'post', path: (id) => `${O}/${id}/cod/settle`, body: {}, idempotent: true },
    target: (victim) => victim[which],
  },
  // The delivery (§7.2, §9.4).
  {
    covers: 'PATCH /orders/:id/delivery',
    name: `edit the delivery of ${which}`,
    route: { method: 'patch', path: (id) => `${O}/${id}/delivery`, body: { notes: 'Taken' } },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/delivery/dispatch',
    name: `dispatch ${which}`,
    route: {
      method: 'post',
      path: (id) => `${O}/${id}/delivery/dispatch`,
      body: { courierName: 'Taken' },
    },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/delivery/delivered',
    name: `mark ${which} delivered`,
    route: { method: 'post', path: (id) => `${O}/${id}/delivery/delivered`, body: {} },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/delivery/failed',
    name: `mark the delivery of ${which} failed`,
    route: {
      method: 'post',
      path: (id) => `${O}/${id}/delivery/failed`,
      body: { reason: 'Taken' },
    },
    target: (victim) => victim[which],
  },
  {
    covers: 'POST /orders/:id/delivery/returned',
    name: `mark ${which} returned`,
    route: {
      method: 'post',
      path: (id) => `${O}/${id}/delivery/returned`,
      body: { reason: 'Taken' },
    },
    target: (victim) => victim[which],
  },
]);

describe.each([
  ['A attacks B', () => [a, b] as const],
  ['B attacks A', () => [b, a] as const],
])('%s', (_label, parties) => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    'gets the standard 404: %s',
    async (_name, attack) => {
      const [attacker, victim] = parties();
      const before = await snapshot(victim);
      await expectCrossTenant404(server, attacker.tenant, attack.route, attack.target(victim));
      expect(await snapshot(victim)).toEqual(before);
    },
  );
});

describe('IDs that are not UUIDs', () => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    'get the same 404: %s',
    async (_name, attack) => {
      const res = await callRoute(server, a.tenant, attack.route, 'not-a-uuid');
      expect(res.status).toBe(404);
      expect(withoutRequestId(res.body)).toEqual({
        code: 'NOT_FOUND',
        message: 'Not found.',
        fieldErrors: {},
      });
    },
  );
});

// ---------- The list ----------

describe('GET /orders never shows another business’s orders', () => {
  const list = async (query: Record<string, string> = {}) =>
    (await request(server).get(O).query(query).set(as(a.tenant)).expect(200))
      .body as Page<OrderSummary>;

  it('the unfiltered list holds exactly the caller’s own orders', async () => {
    const own = await prisma.order.findMany({
      where: { businessId: a.tenant.businessId },
      select: { id: true },
    });
    const page = await list({ pageSize: '100' });
    expect(page.items.map((order) => order.id).sort()).toEqual(own.map((order) => order.id).sort());
  });

  it('finds nothing when searching for B’s order number, name or phone', async () => {
    for (const q of [b.orderNumber, 'Bravo', '0772220002', '+94 77 222 0002']) {
      expect((await list({ q })).total, `search "${q}"`).toBe(0);
    }
  });
});

// ---------- References to another business's records ----------

describe('an order can’t point at another business’s records', () => {
  const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found.', fieldErrors: {} };

  it('create with B’s customer: the standard 404, and nothing is written', async () => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await createOrder(a.tenant, orderBody(a, { customerId: b.customer })).expect(404);
    expect(withoutRequestId(res.body)).toEqual(NOT_FOUND);
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it('create with B’s product: refused as unavailable, and nothing is written', async () => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await createOrder(
      a.tenant,
      orderBody(a, { items: [{ productId: b.product, quantity: 1 }] }),
    ).expect(422);
    expect(res.body).toMatchObject({
      code: 'PRODUCT_NOT_AVAILABLE',
      fieldErrors: { 'items[0].productId': expect.any(String) },
    });
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it('create with B’s saved address (and A’s own customer): refused, nothing is written', async () => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await createOrder(
      a.tenant,
      orderBody(a, { delivery: { ...ADDRESS, sourceAddressId: b.address } }),
    ).expect(422);
    expect(res.body).toMatchObject({ code: 'ADDRESS_NOT_AVAILABLE' });
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it('edit to B’s product: refused, and A’s order is unchanged', async () => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await request(server)
      .patch(`${O}/${a.order}`)
      .set(as(a.tenant))
      .send({ items: [{ productId: b.product, quantity: 1 }] })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'PRODUCT_NOT_AVAILABLE' });
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it('switch to delivery with B’s saved address: refused, and nothing is written', async () => {
    const pickup = await createOrder(
      a.tenant,
      orderBody(a, { fulfilmentType: 'PICKUP', paymentMethod: 'CASH', delivery: undefined }),
    ).expect(201);
    const before = [await snapshot(a), await snapshot(b)];
    const res = await request(server)
      .patch(`${O}/${(pickup.body as OrderDetail).id}`)
      .set(as(a.tenant))
      .send({ fulfilmentType: 'DELIVERY', delivery: { ...ADDRESS, sourceAddressId: b.address } })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'ADDRESS_NOT_AVAILABLE' });
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });
});

// ---------- COD across orders (§2.2, §9.4) ----------

describe('COD across orders never reaches another business', () => {
  /** Takes one of `owner`'s new COD orders to delivered: its COD is COLLECTED. */
  async function collected(owner: Owned): Promise<string> {
    const order = (await createOrder(owner.tenant, orderBody(owner)).expect(201))
      .body as OrderDetail;
    const step = (path: string, body: object) =>
      request(server).post(`${O}/${order.id}${path}`).set(as(owner.tenant)).send(body).expect(200);
    await step('/status', { to: 'CONFIRMED' });
    await step('/status', { to: 'READY' });
    await step('/delivery/dispatch', { courierName: 'Domex' });
    await step('/delivery/delivered', {});
    return order.id;
  }
  const settle = (tenant: Tenant, orderIds: string[]) =>
    request(server)
      .post('/api/v1/cod/settle')
      .set(as(tenant))
      .set('Idempotency-Key', randomUUID())
      .send({ orderIds });

  it('GET /cod/awaiting lists only the caller’s own collected COD', async () => {
    const mine = await collected(a);
    const theirs = await collected(b);
    const page = (
      await request(server).get('/api/v1/cod/awaiting?pageSize=100').set(as(a.tenant)).expect(200)
    ).body as Page<CodAwaitingItem>;
    const ids = page.items.map((item) => item.orderId);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it.each([
    ['A settles B’s COD', () => [a, b] as const],
    ['B settles A’s COD', () => [b, a] as const],
  ])(
    'POST /cod/settle: %s gets the standard 404, and nothing is written',
    async (_label, parties) => {
      const [attacker, victim] = parties();
      const foreign = await collected(victim);
      const own = await collected(attacker);
      const before = [await snapshot(attacker), await snapshot(victim)];
      // Alone or hidden among the attacker's own orders, the answer is the same as for no order.
      for (const orderIds of [[foreign], [own, foreign]]) {
        const res = await settle(attacker.tenant, orderIds).expect(404);
        const missing = await settle(attacker.tenant, [randomUUID()]).expect(404);
        expect(withoutRequestId(res.body)).toEqual(withoutRequestId(missing.body));
      }
      expect([await snapshot(attacker), await snapshot(victim)]).toEqual(before);
    },
  );
});

// ---------- Possible duplicates (§2.2) ----------

describe('the duplicate-order check never reaches another business', () => {
  const check = (tenant: Tenant, customerId: string, total: string) =>
    request(server).get(`${O}/possible-duplicates`).query({ customerId, total }).set(as(tenant));

  it.each([
    ['A asks about B’s customer', () => [a, b] as const],
    ['B asks about A’s customer', () => [b, a] as const],
  ])('%s: the standard 404', async (_label, parties) => {
    const [attacker, victim] = parties();
    const foreign = await check(attacker.tenant, victim.customer, '100').expect(404);
    const missing = await check(attacker.tenant, randomUUID(), '100').expect(404);
    expect(withoutRequestId(foreign.body)).toEqual(withoutRequestId(missing.body));
  });

  it('another business’s order for the same phone and total is never listed', async () => {
    // B has a customer with A's customer's phone, and has just taken an order for them.
    const { phoneNormalized, phoneDisplay } = await prisma.customer.findUniqueOrThrow({
      where: { id: a.customer },
    });
    const twin = await prisma.customer.create({
      data: { businessId: b.tenant.businessId, name: 'Same Phone', phoneNormalized, phoneDisplay },
    });
    const theirs = (
      await createOrder(
        b.tenant,
        orderBody(b, {
          customerId: twin.id,
          fulfilmentType: 'PICKUP',
          paymentMethod: 'CASH',
          delivery: undefined,
        }),
      ).expect(201)
    ).body as OrderDetail;
    const res = await check(a.tenant, a.customer, theirs.totalAmount).expect(200);
    expect((res.body as { id: string }[]).map((order) => order.id)).not.toContain(theirs.id);
  });
});

// ---------- businessId sent by the client ----------

describe('a businessId from the client is refused (400), and nothing is written', () => {
  const rejected = {
    code: 'VALIDATION_ERROR',
    fieldErrors: { businessId: 'This field is not allowed.' },
  };

  it.each([
    [
      'POST /orders',
      () => createOrder(a.tenant, { ...orderBody(a), businessId: b.tenant.businessId }),
    ],
    [
      'PATCH /orders/:id',
      () =>
        request(server)
          .patch(`${O}/${a.order}`)
          .set(as(a.tenant))
          .send({ notes: 'Moved', businessId: b.tenant.businessId }),
    ],
    [
      'POST /orders/:id/status',
      () =>
        request(server)
          .post(`${O}/${a.order}/status`)
          .set(as(a.tenant))
          .send({ to: 'CONFIRMED', businessId: b.tenant.businessId }),
    ],
    [
      'POST /orders/:id/cancel',
      () =>
        request(server)
          .post(`${O}/${a.order}/cancel`)
          .set(as(a.tenant))
          .send({ reason: 'Moved', businessId: b.tenant.businessId }),
    ],
    [
      'GET /orders',
      () => request(server).get(O).query({ businessId: b.tenant.businessId }).set(as(a.tenant)),
    ],
    [
      'POST /orders/:id/payments',
      () =>
        request(server)
          .post(`${O}/${a.order}/payments`)
          .set(as(a.tenant))
          .set('Idempotency-Key', randomUUID())
          .send({ type: 'PAYMENT', method: 'CASH', amount: '1', businessId: b.tenant.businessId }),
    ],
    [
      'PATCH /orders/:id/delivery',
      () =>
        request(server)
          .patch(`${O}/${a.order}/delivery`)
          .set(as(a.tenant))
          .send({ notes: 'Moved', businessId: b.tenant.businessId }),
    ],
    [
      'POST /cod/settle',
      () =>
        request(server)
          .post('/api/v1/cod/settle')
          .set(as(a.tenant))
          .set('Idempotency-Key', randomUUID())
          .send({ orderIds: [a.order], businessId: b.tenant.businessId }),
    ],
  ] as const)('%s', async (_route, call) => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await call().expect(400);
    expect(res.body).toMatchObject(rejected);
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });
});

// ---------- Coverage guard ----------

/** "METHOD /path" for every route a controller declares, e.g. "PATCH /orders/:id". */
function declaredRoutes(controller: Type): string[] {
  const join = (...parts: (string | undefined)[]) =>
    `/${parts
      .flatMap((part) => (part ?? '').split('/'))
      .filter((part) => part !== '')
      .join('/')}`;
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (typeof handler !== 'function' || name === 'constructor') return [];
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (path === undefined || method === undefined) return [];
    return [`${RequestMethod[method]} ${join(base, path)}`];
  });
}

describe('coverage guard', () => {
  /** Routes checked above that take no order ID: the list, create, and COD across orders. */
  const noIdRoutes = [
    'GET /orders',
    'POST /orders',
    'GET /orders/possible-duplicates',
    'GET /cod/awaiting',
    'POST /cod/settle',
  ];
  const controllers = [
    OrdersController,
    PaymentsController,
    CodController,
    CodBulkController,
    DeliveriesController,
  ];

  it('every order, payment, delivery and COD route is covered by this sweep', () => {
    const declared = controllers.flatMap(declaredRoutes).sort();
    const covered = [...new Set([...attacks.map((attack) => attack.covers), ...noIdRoutes])].sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared, 'add every new route to the isolation sweep (C17, D9)').toEqual(covered);
  });
});
