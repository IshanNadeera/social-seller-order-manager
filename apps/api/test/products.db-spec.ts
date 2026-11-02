// Products API against the real database (docs/DEVELOPMENT.md §6.7, §8.2, §9.3, task B4).
// Needs a migrated local database. Run with: npm run test:db -w apps/api
// Full cross-tenant coverage of every product endpoint is task B5; basic 404s are checked here.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Page, ProductView } from '@ssom/shared';
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

const BASE = '/api/v1/products';

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;

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

async function create(tenant: Tenant, body: object): Promise<ProductView> {
  const res = await request(server).post(BASE).set(as(tenant)).send(body).expect(201);
  return res.body as ProductView;
}

async function list(
  tenant: Tenant,
  query: Record<string, string> = {},
): Promise<Page<ProductView>> {
  const res = await request(server).get(BASE).query(query).set(as(tenant)).expect(200);
  return res.body as Page<ProductView>;
}

const archive = (tenant: Tenant, id: string) =>
  request(server).post(`${BASE}/${id}/archive`).set(as(tenant));

describe('POST /products', () => {
  it('creates a product; money comes back as a string with two decimals', async () => {
    const product = await create(tenants.a, {
      name: ' Silk Saree ',
      sku: ' SAR-001 ',
      description: 'Handloom',
      sellingPrice: '4500.5',
    });
    expect(product).toMatchObject({
      name: 'Silk Saree',
      sku: 'SAR-001',
      description: 'Handloom',
      sellingPrice: '4500.50',
      archivedAt: null,
    });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.businessId).toBe(tenants.a.businessId);
    expect(row.sellingPrice.toFixed(2)).toBe('4500.50');
  });

  it('accepts no SKU (blank means none), and several products without one', async () => {
    const first = await create(tenants.a, { name: 'Gift Wrap', sku: '', sellingPrice: '0' });
    const second = await create(tenants.a, { name: 'Gift Card', sellingPrice: '1000' });
    expect([first.sku, second.sku]).toEqual([null, null]);
    expect(first.sellingPrice).toBe('0.00');
  });

  it('refuses a price sent as a number, a negative price and unknown fields', async () => {
    const res = await request(server)
      .post(BASE)
      .set(as(tenants.a))
      .send({ name: 'Bad', sellingPrice: 100, businessId: tenants.b.businessId })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        sellingPrice: 'Enter the amount as text, like "1500.00".',
        businessId: 'This field is not allowed.',
      },
    });
    const negative = await request(server)
      .post(BASE)
      .set(as(tenants.a))
      .send({ name: 'Bad', sellingPrice: '-1' })
      .expect(400);
    expect(negative.body).toMatchObject({
      fieldErrors: {
        sellingPrice: 'Enter an amount from 0 to 99,999,999.99, with at most 2 decimals.',
      },
    });
  });
});

describe('SKU unique among active products', () => {
  it('refuses a SKU another active product uses, with a field error', async () => {
    await create(tenants.a, { name: 'Batik Shirt', sku: 'BAT-1', sellingPrice: '2500' });
    const res = await request(server)
      .post(BASE)
      .set(as(tenants.a))
      .send({ name: 'Batik Shirt 2', sku: 'BAT-1', sellingPrice: '2600' })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'SKU_TAKEN',
      fieldErrors: { sku: 'Another active product already uses this SKU.' },
    });
  });

  it('refuses taking a used SKU by editing too', async () => {
    await create(tenants.a, { name: 'Kandyan Mask', sku: 'MSK-1', sellingPrice: '3000' });
    const other = await create(tenants.a, {
      name: 'Raksha Mask',
      sku: 'MSK-2',
      sellingPrice: '3200',
    });
    const res = await request(server)
      .patch(`${BASE}/${other.id}`)
      .set(as(tenants.a))
      .send({ sku: 'MSK-1' })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'SKU_TAKEN' });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: other.id } })).sku).toBe('MSK-2');
  });

  it('frees the SKU when a product is archived', async () => {
    const old = await create(tenants.a, { name: 'Old Tea', sku: 'TEA-1', sellingPrice: '450' });
    await archive(tenants.a, old.id).expect(200);
    const replacement = await create(tenants.a, {
      name: 'New Tea',
      sku: 'TEA-1',
      sellingPrice: '480',
    });
    expect(replacement.sku).toBe('TEA-1');
  });

  it('lets another business use the same SKU', async () => {
    await create(tenants.a, { name: 'Shared SKU A', sku: 'SAME-1', sellingPrice: '1' });
    expect(
      (await create(tenants.b, { name: 'Shared SKU B', sku: 'SAME-1', sellingPrice: '1' })).sku,
    ).toBe('SAME-1');
  });

  it('gives exactly one success when two requests take the same SKU at once', async () => {
    const take = () =>
      request(server)
        .post(BASE)
        .set(as(tenants.a))
        .send({ name: 'Race Demo', sku: 'RACE-1', sellingPrice: '10' });
    const statuses = (await Promise.all([take(), take()])).map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe('GET /products (search)', () => {
  beforeAll(async () => {
    await create(tenants.b, { name: 'Coconut Oil 500ml', sku: 'CO-500', sellingPrice: '900' });
    await create(tenants.b, { name: 'Coconut Oil 1L', sku: 'CO-1000', sellingPrice: '1700' });
    await create(tenants.b, { name: 'Ginger Beer', sku: 'GB_6', sellingPrice: '600' });
    const archived = await create(tenants.b, { name: 'Coconut Candy', sellingPrice: '200' });
    await archive(tenants.b, archived.id).expect(200);
  });

  it('finds by part of the name or SKU, ignoring case', async () => {
    expect((await list(tenants.b, { q: 'coconut' })).items.map((item) => item.name)).toEqual([
      'Coconut Oil 1L',
      'Coconut Oil 500ml',
    ]);
    expect((await list(tenants.b, { q: 'co-1000' })).items.map((item) => item.name)).toEqual([
      'Coconut Oil 1L',
    ]);
  });

  it('treats _ and % literally', async () => {
    expect((await list(tenants.b, { q: '_' })).items.map((item) => item.sku)).toEqual(['GB_6']);
    expect((await list(tenants.b, { q: '%' })).total).toBe(0);
  });

  it('includes archived products only with includeArchived=true', async () => {
    expect((await list(tenants.b, { q: 'candy' })).total).toBe(0);
    const withArchived = await list(tenants.b, { q: 'candy', includeArchived: 'true' });
    expect(withArchived.items[0]).toMatchObject({
      name: 'Coconut Candy',
      archivedAt: expect.any(String) as string,
    });
  });

  it('pages in a stable order with the total count, never another business’s products', async () => {
    const first = await list(tenants.b, { pageSize: '2' });
    const second = await list(tenants.b, { pageSize: '2', page: '2' });
    expect(first.total).toBe(second.total);
    const names = [...first.items, ...second.items].map((item) => item.name);
    expect(names).toEqual([...names].sort());
    expect(names).not.toContain('Shared SKU A');
  });
});

describe('PATCH /products/:id and archive', () => {
  it('changes only what is sent; null clears the SKU and description', async () => {
    const product = await create(tenants.a, {
      name: 'Clay Pot',
      sku: 'POT-1',
      description: 'Small',
      sellingPrice: '750',
    });
    const res = await request(server)
      .patch(`${BASE}/${product.id}`)
      .set(as(tenants.a))
      .send({ sellingPrice: '800.25', sku: null, description: '' })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Clay Pot',
      sku: null,
      description: null,
      sellingPrice: '800.25',
    });
  });

  it('archives once (repeating keeps the first date) and then refuses edits', async () => {
    const product = await create(tenants.a, { name: 'Retired Item', sellingPrice: '5' });
    const first = await archive(tenants.a, product.id).expect(200);
    const archivedAt = (first.body as ProductView).archivedAt;
    expect(archivedAt).not.toBeNull();
    const again = await archive(tenants.a, product.id).expect(200);
    expect((again.body as ProductView).archivedAt).toBe(archivedAt);

    await request(server).get(`${BASE}/${product.id}`).set(as(tenants.a)).expect(200);
    const res = await request(server)
      .patch(`${BASE}/${product.id}`)
      .set(as(tenants.a))
      .send({ name: 'Changed' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'PRODUCT_ARCHIVED' });
  });

  it('asks for at least one change', async () => {
    const product = await create(tenants.a, { name: 'Nothing Product', sellingPrice: '1' });
    const res = await request(server)
      .patch(`${BASE}/${product.id}`)
      .set(as(tenants.a))
      .send({})
      .expect(400);
    expect(res.body).toMatchObject({ message: 'Change at least one field.' });
  });
});

describe('tenant isolation (basic; full sweep in B5)', () => {
  it("answers another business's product with the standard 404 on every route", async () => {
    const ofB = await create(tenants.b, {
      name: 'Private Product B',
      sku: 'PRIV-1',
      sellingPrice: '9',
    });
    const routes = [
      { method: 'get' as const, path: (id: string) => `${BASE}/${id}` },
      { method: 'patch' as const, path: (id: string) => `${BASE}/${id}`, body: { name: 'Taken' } },
      { method: 'post' as const, path: (id: string) => `${BASE}/${id}/archive` },
    ];
    for (const route of routes) await expectCrossTenant404(server, tenants.a, route, ofB.id);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: ofB.id } });
    expect(row).toMatchObject({ name: 'Private Product B', archivedAt: null });
  });
});
