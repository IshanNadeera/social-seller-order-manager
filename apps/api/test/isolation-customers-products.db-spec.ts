// Tenant isolation sweep for customers, addresses and products (docs/DEVELOPMENT.md §11.1, §12.4,
// task B5). Business A attacks business B (and B attacks A) on every route that takes an ID, and
// every list and create route is checked for leaks and client-supplied business IDs.
// Needs a migrated local database. Run with: npm run test:db -w apps/api
//
// A coverage guard at the end lists the routes the controllers actually register. A new customer,
// address or product route fails it until it is added to this sweep.
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import type { Type } from '@nestjs/common';
// Nest's own decorator metadata keys, read only by the coverage guard below.
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { CustomerDetail, ProductView } from '@ssom/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { AddressesController } from '../src/customers/addresses.controller';
import { CustomersController } from '../src/customers/customers.controller';
import { ProductsController } from '../src/products/products.controller';
import { createTestAuth } from './test-auth';
import { createTwoTenants, expectCrossTenant404, withoutRequestId } from './tenant-isolation';
import type { RouteUnderTest, Tenant, TwoTenants } from './tenant-isolation';

// Fake people, numbers and products only.
const ADDRESS = { recipientName: 'Iso Demo', phone: '0770000001', addressLine1: '1 Iso Road' };

/** The records one business owns, as seen by the sweep. */
interface Owned {
  tenant: Tenant;
  customer: string;
  archivedCustomer: string;
  address: string;
  /** An address of the archived customer. */
  archivedCustomerAddress: string;
  product: string;
  archivedProduct: string;
}

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let a: Owned;
let b: Owned;

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });

/** Creates the same set of records for one business through the API (as its own owner). */
async function seed(tenant: Tenant, label: string, phone: string, sku: string): Promise<Owned> {
  const post = async <Body>(path: string, body?: object): Promise<Body> => {
    const req = request(server).post(path).set(as(tenant));
    const res = await (body === undefined ? req : req.send(body));
    expect(res.status, `seed POST ${path}`).toBeLessThan(300);
    return res.body as Body;
  };
  const customer = await post<CustomerDetail>('/api/v1/customers', {
    name: `${label} Customer`,
    phone,
    address: ADDRESS,
  });
  const archived = await post<CustomerDetail>('/api/v1/customers', {
    name: `${label} Archived Customer`,
    address: ADDRESS,
  });
  await post(`/api/v1/customers/${archived.id}/archive`);
  const product = await post<ProductView>('/api/v1/products', {
    name: `${label} Product`,
    sku,
    sellingPrice: '100',
  });
  const archivedProduct = await post<ProductView>('/api/v1/products', {
    name: `${label} Archived Product`,
    sku: `${sku}-OLD`,
    sellingPrice: '50',
  });
  await post(`/api/v1/products/${archivedProduct.id}/archive`);

  const firstAddress = (detail: CustomerDetail) => {
    const [address] = detail.addresses;
    if (address === undefined) throw new Error('seed: customer has no address');
    return address.id;
  };
  return {
    tenant,
    customer: customer.id,
    archivedCustomer: archived.id,
    address: firstAddress(customer),
    archivedCustomerAddress: firstAddress(archived),
    product: product.id,
    archivedProduct: archivedProduct.id,
  };
}

/** Everything business `owner` has in the three tables, to prove an attack changed nothing. */
async function snapshot(owner: Owned) {
  const where = { businessId: owner.tenant.businessId };
  const byId = { id: 'asc' as const };
  return {
    customers: await prisma.customer.findMany({ where, orderBy: byId }),
    addresses: await prisma.customerAddress.findMany({ where, orderBy: byId }),
    products: await prisma.product.findMany({ where, orderBy: byId }),
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

// ---------- Routes that take an ID ----------

/**
 * One attack: `attacker` calls `route`, where the path is built from one foreign ID (the `id`
 * expectCrossTenant404 varies) and possibly one of the attacker's own IDs.
 */
interface Attack {
  /** The route as the controllers declare it, for the coverage guard. */
  covers: string;
  name: string;
  /** Builds the route; `id` in its path is the victim ID being tried, the rest is fixed. */
  route: (attacker: Owned, victim: Owned) => RouteUnderTest;
  /** The victim's ID that the attacker tries. */
  target: (victim: Owned) => string;
}

const C = '/api/v1/customers';
const P = '/api/v1/products';
const newAddress = { ...ADDRESS, addressLine1: '9 Taken Road' };

const attacks: Attack[] = [
  // Customers: the victim's active and archived customers.
  ...(['customer', 'archivedCustomer'] as const).flatMap((which): Attack[] => [
    {
      covers: 'GET /customers/:id',
      name: `read ${which}`,
      route: () => ({ method: 'get', path: (id) => `${C}/${id}` }),
      target: (victim) => victim[which],
    },
    {
      covers: 'GET /customers/:id/orders',
      name: `read the order history of ${which}`,
      route: () => ({ method: 'get', path: (id) => `${C}/${id}/orders` }),
      target: (victim) => victim[which],
    },
    {
      covers: 'PATCH /customers/:id',
      name: `update ${which}`,
      route: () => ({ method: 'patch', path: (id) => `${C}/${id}`, body: { name: 'Taken' } }),
      target: (victim) => victim[which],
    },
    {
      covers: 'POST /customers/:id/archive',
      name: `archive ${which}`,
      route: () => ({ method: 'post', path: (id) => `${C}/${id}/archive` }),
      target: (victim) => victim[which],
    },
    {
      covers: 'POST /customers/:id/addresses',
      name: `add an address to ${which}`,
      route: () => ({ method: 'post', path: (id) => `${C}/${id}/addresses`, body: newAddress }),
      target: (victim) => victim[which],
    },
  ]),

  // Addresses: every mix of whose customer and whose address is in the path.
  ...(
    [
      {
        covers: 'PATCH /customers/:id/addresses/:addressId',
        verb: 'update',
        method: 'patch',
        suffix: '',
        body: { label: 'Taken' },
      },
      {
        covers: 'POST /customers/:id/addresses/:addressId/archive',
        verb: 'archive',
        method: 'post',
        suffix: '/archive',
        body: undefined,
      },
    ] as const
  ).flatMap(({ covers, verb, method, suffix, body }): Attack[] => [
    {
      covers,
      name: `${verb} the victim's address under the victim's customer`,
      route: (_attacker, victim) => ({
        method,
        path: (id) => `${C}/${id}/addresses/${victim.address}${suffix}`,
        body,
      }),
      target: (victim) => victim.customer,
    },
    {
      covers,
      name: `${verb} the victim's address under the attacker's own customer`,
      route: (attacker) => ({
        method,
        path: (id) => `${C}/${attacker.customer}/addresses/${id}${suffix}`,
        body,
      }),
      target: (victim) => victim.address,
    },
    {
      covers,
      name: `${verb} the attacker's own address under the victim's customer`,
      route: (attacker) => ({
        method,
        path: (id) => `${C}/${id}/addresses/${attacker.address}${suffix}`,
        body,
      }),
      target: (victim) => victim.customer,
    },
    {
      covers,
      name: `${verb} an address of the victim's archived customer`,
      route: (attacker) => ({
        method,
        path: (id) => `${C}/${attacker.customer}/addresses/${id}${suffix}`,
        body,
      }),
      target: (victim) => victim.archivedCustomerAddress,
    },
  ]),

  // Products: the victim's active and archived products.
  ...(['product', 'archivedProduct'] as const).flatMap((which): Attack[] => [
    {
      covers: 'GET /products/:id',
      name: `read ${which}`,
      route: () => ({ method: 'get', path: (id) => `${P}/${id}` }),
      target: (victim) => victim[which],
    },
    {
      covers: 'PATCH /products/:id',
      name: `update ${which}`,
      route: () => ({ method: 'patch', path: (id) => `${P}/${id}`, body: { name: 'Taken' } }),
      target: (victim) => victim[which],
    },
    {
      covers: 'POST /products/:id/archive',
      name: `archive ${which}`,
      route: () => ({ method: 'post', path: (id) => `${P}/${id}/archive` }),
      target: (victim) => victim[which],
    },
  ]),
];

describe.each([
  ['A attacks B', () => [a, b] as const],
  ['B attacks A', () => [b, a] as const],
])('%s', (_label, parties) => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    'gets the standard 404: %s',
    async (_name, attack) => {
      const [attacker, victim] = parties();
      const before = await snapshot(victim);
      await expectCrossTenant404(
        server,
        attacker.tenant,
        attack.route(attacker, victim),
        attack.target(victim),
      );
      expect(await snapshot(victim)).toEqual(before);
    },
  );
});

describe('IDs that are not UUIDs', () => {
  it.each(attacks.map((attack) => [attack.name, attack] as const))(
    'get the same 404: %s',
    async (_name, attack) => {
      const route = attack.route(a, b);
      const call = request(server)[route.method](route.path('not-a-uuid')).set(as(a.tenant));
      const res = await (route.body === undefined ? call : call.send(route.body));
      expect(res.status).toBe(404);
      expect(withoutRequestId(res.body)).toEqual({
        code: 'NOT_FOUND',
        message: 'Not found.',
        fieldErrors: {},
      });
    },
  );
});

// ---------- Lists ----------

describe('lists never show another business’s records', () => {
  it.each(['Bravo', 'Bravo Archived Customer', '0772220002', '+94 77 222 0002', '772220002'])(
    'customer search for %j finds nothing of B, even with archived included',
    async (q) => {
      for (const includeArchived of ['false', 'true']) {
        const res = await request(server)
          .get(C)
          .query({ q, includeArchived })
          .set(as(a.tenant))
          .expect(200);
        expect(res.body).toMatchObject({ items: [], total: 0 });
      }
    },
  );

  it.each(['Bravo', 'BRAVO-1', 'bravo-1-old'])(
    'product search for %j finds nothing of B, even with archived included',
    async (q) => {
      for (const includeArchived of ['false', 'true']) {
        const res = await request(server)
          .get(P)
          .query({ q, includeArchived })
          .set(as(a.tenant))
          .expect(200);
        expect(res.body).toMatchObject({ items: [], total: 0 });
      }
    },
  );

  it('the full, unfiltered lists hold exactly the caller’s own records', async () => {
    const customers = await request(server)
      .get(C)
      .query({ includeArchived: 'true', pageSize: '100' })
      .set(as(a.tenant))
      .expect(200);
    const products = await request(server)
      .get(P)
      .query({ includeArchived: 'true', pageSize: '100' })
      .set(as(a.tenant))
      .expect(200);
    const ids = (body: unknown) =>
      (body as { items: { id: string }[] }).items.map((item) => item.id).sort();
    expect(ids(customers.body)).toEqual([a.customer, a.archivedCustomer].sort());
    expect(ids(products.body)).toEqual([a.product, a.archivedProduct].sort());
  });
});

// ---------- businessId sent by the client ----------

describe('a businessId from the client', () => {
  const rejected = {
    code: 'VALIDATION_ERROR',
    fieldErrors: { businessId: 'This field is not allowed.' },
  };

  it.each([
    ['POST', '/customers', () => ({ path: C, body: { name: 'Planted' } })],
    ['POST', '/products', () => ({ path: P, body: { name: 'Planted', sellingPrice: '1' } })],
    [
      'POST',
      '/customers/:id/addresses',
      () => ({ path: `${C}/${a.customer}/addresses`, body: ADDRESS }),
    ],
  ] as const)('is rejected in the body of %s %s, and nothing is written', async (_m, _p, call) => {
    const { path, body } = call();
    const before = [await snapshot(a), await snapshot(b)];
    const res = await request(server)
      .post(path)
      .set(as(a.tenant))
      .send({ ...body, businessId: b.tenant.businessId })
      .expect(400);
    expect(res.body).toMatchObject(rejected);
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it.each([
    ['/customers/:id', () => `${C}/${a.customer}`, { name: 'Moved' }],
    [
      '/customers/:id/addresses/:addressId',
      () => `${C}/${a.customer}/addresses/${a.address}`,
      { label: 'Moved' },
    ],
    ['/products/:id', () => `${P}/${a.product}`, { name: 'Moved' }],
  ] as const)('is rejected in the body of PATCH %s', async (_p, path, body) => {
    const before = [await snapshot(a), await snapshot(b)];
    const res = await request(server)
      .patch(path())
      .set(as(a.tenant))
      .send({ ...body, businessId: b.tenant.businessId })
      .expect(400);
    expect(res.body).toMatchObject(rejected);
    expect([await snapshot(a), await snapshot(b)]).toEqual(before);
  });

  it.each([C, P])('is rejected in the query of GET %s', async (path) => {
    const res = await request(server)
      .get(path)
      .query({ businessId: b.tenant.businessId })
      .set(as(a.tenant))
      .expect(400);
    expect(res.body).toMatchObject(rejected);
  });

  it('is ignored where a route reads no query: the caller still sees only their own record', async () => {
    const query = { businessId: b.tenant.businessId };
    const own = await request(server)
      .get(`${C}/${a.customer}`)
      .query(query)
      .set(as(a.tenant))
      .expect(200);
    expect((own.body as CustomerDetail).name).toBe('Alpha Customer');
    await request(server).get(`${C}/${b.customer}`).query(query).set(as(a.tenant)).expect(404);
    await request(server).get(`${P}/${b.product}`).query(query).set(as(a.tenant)).expect(404);
  });

  it('is ignored in the body of an archive: the caller can archive only their own record', async () => {
    const before = await snapshot(b);
    const body = { businessId: b.tenant.businessId };
    await request(server)
      .post(`${C}/${b.customer}/archive`)
      .set(as(a.tenant))
      .send(body)
      .expect(404);
    await request(server)
      .post(`${P}/${b.product}/archive`)
      .set(as(a.tenant))
      .send(body)
      .expect(404);
    await request(server)
      .post(`${C}/${b.customer}/addresses/${b.address}/archive`)
      .set(as(a.tenant))
      .send(body)
      .expect(404);
    expect(await snapshot(b)).toEqual(before);
  });
});

// ---------- Coverage guard ----------

/** "METHOD /path" for every route a controller declares, e.g. "PATCH /customers/:id". */
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
  /** Routes checked above that take no ID (lists and creates). */
  const listAndCreateRoutes = [
    'GET /customers',
    'POST /customers',
    'GET /products',
    'POST /products',
  ];

  it('every customer, address and product route is covered by this sweep', () => {
    const declared = [CustomersController, AddressesController, ProductsController]
      .flatMap(declaredRoutes)
      .sort();
    const covered = [
      ...new Set([...attacks.map((attack) => attack.covers), ...listAndCreateRoutes]),
    ].sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared, 'add every new route to the isolation sweep (B5)').toEqual(covered);
  });
});
