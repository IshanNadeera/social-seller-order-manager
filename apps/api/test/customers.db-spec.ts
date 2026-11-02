// Customers API against the real database (docs/DEVELOPMENT.md §6.6, §7.11, §9.2, task B2).
// Needs a migrated local database. Run with: npm run test:db -w apps/api
// Full cross-tenant coverage of every customer endpoint is task B5; basic 404s are checked here.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { CustomerDetail, CustomerSummary, Page } from '@ssom/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { createTestAuth } from './test-auth';
import { createTwoTenants, expectCrossTenant404 } from './tenant-isolation';
import type { Tenant, TwoTenants } from './tenant-isolation';

// Fake people and numbers only.
const BASE = '/api/v1/customers';

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let orderSeq = 0;

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
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });

async function create(tenant: Tenant, body: object): Promise<CustomerDetail> {
  const res = await request(server).post(BASE).set(as(tenant)).send(body).expect(201);
  return res.body as CustomerDetail;
}

async function list(
  tenant: Tenant,
  query: Record<string, string> = {},
): Promise<Page<CustomerSummary>> {
  const res = await request(server).get(BASE).query(query).set(as(tenant)).expect(200);
  return res.body as Page<CustomerSummary>;
}

/** A minimal valid pickup order for the customer (totals satisfy the database CHECKs). */
async function insertOrder(tenant: Tenant, customerId: string, createdAt: Date): Promise<void> {
  orderSeq += 1;
  await prisma.order.create({
    data: {
      businessId: tenant.businessId,
      orderNumber: `TST-${String(orderSeq).padStart(4, '0')}`,
      customerId,
      sourceChannel: 'WHATSAPP',
      fulfilmentType: 'PICKUP',
      paymentMethod: 'CASH',
      currency: 'LKR',
      subtotal: '1000.00',
      totalAmount: '1000.00',
      customerNameSnapshot: 'Snapshot',
      createdById: tenant.userId,
      createdAt,
    },
  });
}

describe('POST /customers', () => {
  it('creates a customer with a normalised phone and lower-cased email', async () => {
    const customer = await create(tenants.a, {
      name: '  Nimali Demo ',
      phone: '077-123 4567',
      email: 'Nimali.Demo@Example.TEST',
      notes: 'Prefers WhatsApp',
    });
    expect(customer).toMatchObject({
      name: 'Nimali Demo',
      phone: '077-123 4567',
      phoneE164: '+94771234567',
      phoneWarning: null,
      email: 'nimali.demo@example.test',
      notes: 'Prefers WhatsApp',
      archivedAt: null,
      orderCount: 0,
      lastOrderAt: null,
      addresses: [],
    });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(row).toMatchObject({
      businessId: tenants.a.businessId,
      phoneDisplay: '077-123 4567',
      phoneNormalized: '+94771234567',
    });
  });

  it('saves a phone it cannot read, with a warning instead of an error', async () => {
    const customer = await create(tenants.a, { name: 'Unreadable Demo', phone: '12345' });
    expect(customer).toMatchObject({
      phone: '12345',
      phoneE164: null,
      phoneWarning: 'PHONE_UNREADABLE',
    });
  });

  it('creates the first address as the default, in the same request', async () => {
    const customer = await create(tenants.a, {
      name: 'Kasun Demo',
      phone: '0712345678',
      address: {
        label: 'Home',
        recipientName: 'Kasun Demo',
        phone: '0712345678',
        addressLine1: '12 Temple Road',
        city: 'Kandy',
        district: 'Kandy',
      },
    });
    expect(customer.addresses).toEqual([
      {
        id: expect.any(String) as string,
        label: 'Home',
        recipientName: 'Kasun Demo',
        phone: '0712345678',
        addressLine1: '12 Temple Road',
        addressLine2: null,
        city: 'Kandy',
        district: 'Kandy',
        postalCode: null,
        isDefault: true,
      },
    ]);
  });

  it('creates nothing when the address is invalid (one transaction)', async () => {
    const before = await prisma.customer.count({ where: { businessId: tenants.a.businessId } });
    const res = await request(server)
      .post(BASE)
      .set(as(tenants.a))
      .send({ name: 'Half Demo', address: { recipientName: 'Half Demo', phone: '077' } })
      .expect(400);
    expect(res.body).toMatchObject({
      fieldErrors: { 'address.addressLine1': 'Enter the address.' },
    });
    expect(await prisma.customer.count({ where: { businessId: tenants.a.businessId } })).toBe(
      before,
    );
  });

  it('refuses unknown fields such as businessId', async () => {
    const res = await request(server)
      .post(BASE)
      .set(as(tenants.a))
      .send({ name: 'Sneaky Demo', businessId: tenants.b.businessId })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { businessId: 'This field is not allowed.' },
    });
  });
});

describe('GET /customers (search)', () => {
  let target: CustomerDetail;

  beforeAll(async () => {
    target = await create(tenants.b, { name: 'Sanduni Perera Demo', phone: '+94 76 555 0101' });
    await create(tenants.b, { name: 'Amal Demo', phone: '0112345678' });
    await create(tenants.b, { name: 'Bimal Demo' });
    // The same number in business A must never show up in B's results.
    await create(tenants.a, { name: 'Sanduni Other Business', phone: '0765550101' });
  });

  it('finds by any part of the name, ignoring case', async () => {
    const page = await list(tenants.b, { q: 'perera' });
    expect(page.items.map((item) => item.id)).toEqual([target.id]);
  });

  it.each(['0765550101', '+94 76 555 0101', '765550101', '0094765550101', '076-555-0101'])(
    'finds by phone written as %s',
    async (q) => {
      const page = await list(tenants.b, { q });
      expect(page.items.map((item) => item.id)).toEqual([target.id]);
    },
  );

  it('pages in a stable order with the total count', async () => {
    const first = await list(tenants.b, { pageSize: '2', page: '1' });
    const second = await list(tenants.b, { pageSize: '2', page: '2' });
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect([...first.items, ...second.items].map((item) => item.name)).toEqual([
      'Amal Demo',
      'Bimal Demo',
      'Sanduni Perera Demo',
    ]);
  });

  it('treats search text literally (no wildcards)', async () => {
    expect((await list(tenants.b, { q: '%' })).total).toBe(0);
    expect((await list(tenants.b, { q: '_' })).total).toBe(0);
  });

  it('refuses page sizes over 100 and unknown parameters', async () => {
    const res = await request(server)
      .get(BASE)
      .query({ pageSize: '101', businessId: tenants.a.businessId })
      .set(as(tenants.b))
      .expect(400);
    expect(res.body).toMatchObject({
      fieldErrors: { pageSize: 'Use at most 100.', businessId: 'This field is not allowed.' },
    });
  });
});

describe('GET /customers/:id', () => {
  it('includes the order count and the latest order date', async () => {
    const customer = await create(tenants.a, { name: 'Repeat Buyer Demo' });
    await insertOrder(tenants.a, customer.id, new Date('2026-10-01T05:00:00Z'));
    await insertOrder(tenants.a, customer.id, new Date('2026-10-20T08:30:00Z'));

    const res = await request(server).get(`${BASE}/${customer.id}`).set(as(tenants.a)).expect(200);
    expect(res.body).toMatchObject({ orderCount: 2, lastOrderAt: '2026-10-20T08:30:00.000Z' });
    expect(res.headers['cache-control']).toBe('no-store');

    const page = await list(tenants.a, { q: 'Repeat Buyer' });
    expect(page.items[0]).toMatchObject({ orderCount: 2, lastOrderAt: '2026-10-20T08:30:00.000Z' });
  });
});

describe('PATCH /customers/:id', () => {
  it('changes only what is sent and normalises a new phone', async () => {
    const customer = await create(tenants.a, { name: 'Edit Demo', email: 'edit@example.test' });
    const res = await request(server)
      .patch(`${BASE}/${customer.id}`)
      .set(as(tenants.a))
      .send({ phone: '+94 77 999 0000' })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Edit Demo',
      email: 'edit@example.test',
      phone: '+94 77 999 0000',
      phoneE164: '+94779990000',
    });
  });

  it('clears a field with null or an empty value', async () => {
    const customer = await create(tenants.a, {
      name: 'Clear Demo',
      phone: '0771112233',
      notes: 'x',
    });
    const res = await request(server)
      .patch(`${BASE}/${customer.id}`)
      .set(as(tenants.a))
      .send({ phone: null, notes: '' })
      .expect(200);
    expect(res.body).toMatchObject({
      phone: null,
      phoneE164: null,
      phoneWarning: null,
      notes: null,
    });
  });

  it('asks for at least one change', async () => {
    const customer = await create(tenants.a, { name: 'Nothing Demo' });
    const res = await request(server)
      .patch(`${BASE}/${customer.id}`)
      .set(as(tenants.a))
      .send({})
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Change at least one field.',
    });
  });
});

describe('POST /customers/:id/archive', () => {
  it('archives, hides from the list, keeps the record readable, and is safe to repeat', async () => {
    const customer = await create(tenants.a, { name: 'Archive Me Demo' });
    const first = await request(server)
      .post(`${BASE}/${customer.id}/archive`)
      .set(as(tenants.a))
      .expect(200);
    const archivedAt = (first.body as CustomerDetail).archivedAt;
    expect(archivedAt).not.toBeNull();

    const again = await request(server)
      .post(`${BASE}/${customer.id}/archive`)
      .set(as(tenants.a))
      .expect(200);
    expect((again.body as CustomerDetail).archivedAt).toBe(archivedAt);

    expect((await list(tenants.a, { q: 'Archive Me' })).total).toBe(0);
    expect((await list(tenants.a, { q: 'Archive Me', includeArchived: 'true' })).total).toBe(1);
    await request(server).get(`${BASE}/${customer.id}`).set(as(tenants.a)).expect(200);
  });

  it('refuses to edit an archived customer', async () => {
    const customer = await create(tenants.a, { name: 'Frozen Demo' });
    await request(server).post(`${BASE}/${customer.id}/archive`).set(as(tenants.a)).expect(200);
    const res = await request(server)
      .patch(`${BASE}/${customer.id}`)
      .set(as(tenants.a))
      .send({ name: 'Changed' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_ARCHIVED' });
  });
});

describe('tenant isolation (basic; full sweep in B5)', () => {
  it("answers another business's customer with the standard 404 on every route", async () => {
    const ofB = await create(tenants.b, { name: 'Private To B Demo' });
    const routes = [
      { method: 'get' as const, path: (id: string) => `${BASE}/${id}` },
      { method: 'patch' as const, path: (id: string) => `${BASE}/${id}`, body: { name: 'Taken' } },
      { method: 'post' as const, path: (id: string) => `${BASE}/${id}/archive` },
    ];
    for (const route of routes) await expectCrossTenant404(server, tenants.a, route, ofB.id);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: ofB.id } });
    expect(row).toMatchObject({ name: 'Private To B Demo', archivedAt: null });
  });
});
