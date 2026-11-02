// Customer addresses API against the real database (docs/DEVELOPMENT.md §7.11, §8.2, §9.2, task B3).
// Needs a migrated local database. Run with: npm run test:db -w apps/api
// Full cross-tenant coverage of every customer endpoint is task B5; basic 404s are checked here.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MAX_ACTIVE_ADDRESSES } from '@ssom/shared';
import type { CustomerDetail } from '@ssom/shared';
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

// Fake people and addresses only.
const CUSTOMERS = '/api/v1/customers';
const home = {
  label: 'Home',
  recipientName: 'Nimali Demo',
  phone: '0771234567',
  addressLine1: '1 Lake Road',
};
const office = { recipientName: 'Nimali Demo', phone: '0771234567', addressLine1: '2 Office Lane' };
const shop = { recipientName: 'Nimali Demo', phone: '0771234567', addressLine1: '3 Shop Street' };

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
const addressesOf = (customerId: string) => `${CUSTOMERS}/${customerId}/addresses`;

async function newCustomer(tenant: Tenant, name = 'Address Demo'): Promise<string> {
  const res = await request(server).post(CUSTOMERS).set(as(tenant)).send({ name }).expect(201);
  return (res.body as CustomerDetail).id;
}

async function add(tenant: Tenant, customerId: string, body: object): Promise<CustomerDetail> {
  const res = await request(server)
    .post(addressesOf(customerId))
    .set(as(tenant))
    .send(body)
    .expect(201);
  return res.body as CustomerDetail;
}

/** The ID of the active address whose first line is `line1`. */
function idOf(customer: CustomerDetail, line1: string): string {
  const address = customer.addresses.find((item) => item.addressLine1 === line1);
  if (address === undefined) throw new Error(`No active address "${line1}"`);
  return address.id;
}

/** Address lines of the active addresses, the default first (the order GET returns them in). */
const lines = (customer: CustomerDetail) =>
  customer.addresses.map((item) => `${item.addressLine1}${item.isDefault ? ' (default)' : ''}`);

/** Straight from the database: how many active defaults the customer has. Must be 0 or 1. */
const activeDefaults = (customerId: string) =>
  prisma.customerAddress.count({ where: { customerId, isDefault: true, archivedAt: null } });

describe('POST /customers/:id/addresses', () => {
  it('makes the first address the default, even when not asked', async () => {
    const customerId = await newCustomer(tenants.a);
    const customer = await add(tenants.a, customerId, { ...home, isDefault: false });
    expect(customer.addresses).toEqual([
      {
        id: expect.any(String) as string,
        label: 'Home',
        recipientName: 'Nimali Demo',
        phone: '0771234567',
        addressLine1: '1 Lake Road',
        addressLine2: null,
        city: null,
        district: null,
        postalCode: null,
        isDefault: true,
      },
    ]);
  });

  it('adds further addresses as non-default unless asked, and moves the default when asked', async () => {
    const customerId = await newCustomer(tenants.a);
    await add(tenants.a, customerId, home);
    expect(lines(await add(tenants.a, customerId, office))).toEqual([
      '1 Lake Road (default)',
      '2 Office Lane',
    ]);
    expect(lines(await add(tenants.a, customerId, { ...shop, isDefault: true }))).toEqual([
      '3 Shop Street (default)',
      '1 Lake Road',
      '2 Office Lane',
    ]);
    expect(await activeDefaults(customerId)).toBe(1);
  });

  it('needs only the first address line besides recipient and phone', async () => {
    const customerId = await newCustomer(tenants.a);
    const res = await request(server)
      .post(addressesOf(customerId))
      .set(as(tenants.a))
      .send({ recipientName: 'Kasun Demo', phone: '0712345678' })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { addressLine1: 'Enter the address.' },
    });
    expect(res.body).not.toHaveProperty('fieldErrors.city');
  });

  it('refuses unknown fields such as businessId or customerId', async () => {
    const customerId = await newCustomer(tenants.a);
    const res = await request(server)
      .post(addressesOf(customerId))
      .set(as(tenants.a))
      .send({ ...home, businessId: tenants.b.businessId, customerId })
      .expect(400);
    expect(res.body).toMatchObject({
      fieldErrors: {
        businessId: 'This field is not allowed.',
        customerId: 'This field is not allowed.',
      },
    });
  });

  it(`stops at ${MAX_ACTIVE_ADDRESSES} active addresses, and archived ones do not count`, async () => {
    const customerId = await newCustomer(tenants.a);
    await prisma.customerAddress.createMany({
      data: Array.from({ length: MAX_ACTIVE_ADDRESSES }, (_, index) => ({
        businessId: tenants.a.businessId,
        customerId,
        recipientName: 'Bulk Demo',
        phone: '0770000000',
        addressLine1: `${index + 1} Bulk Road`,
        isDefault: index === 0,
      })),
    });
    const res = await request(server)
      .post(addressesOf(customerId))
      .set(as(tenants.a))
      .send(shop)
      .expect(422);
    expect(res.body).toMatchObject({ code: 'ADDRESS_LIMIT_REACHED' });

    const detail = await request(server)
      .get(`${CUSTOMERS}/${customerId}`)
      .set(as(tenants.a))
      .expect(200);
    const last = idOf(detail.body as CustomerDetail, `${MAX_ACTIVE_ADDRESSES} Bulk Road`);
    await request(server)
      .post(`${addressesOf(customerId)}/${last}/archive`)
      .set(as(tenants.a))
      .expect(200);
    await add(tenants.a, customerId, shop);
  });
});

describe('PATCH /customers/:id/addresses/:addressId', () => {
  it('changes only what is sent; null or "" clears an optional field', async () => {
    const customerId = await newCustomer(tenants.a);
    const before = await add(tenants.a, customerId, { ...home, city: 'Kandy', district: 'Kandy' });
    const res = await request(server)
      .patch(`${addressesOf(customerId)}/${idOf(before, '1 Lake Road')}`)
      .set(as(tenants.a))
      .send({ addressLine2: 'Near the temple', city: null, label: '' })
      .expect(200);
    expect((res.body as CustomerDetail).addresses[0]).toMatchObject({
      label: null,
      recipientName: 'Nimali Demo',
      addressLine1: '1 Lake Road',
      addressLine2: 'Near the temple',
      city: null,
      district: 'Kandy',
      isDefault: true,
    });
  });

  it('sets the default: the old default stops being one, in the same change', async () => {
    const customerId = await newCustomer(tenants.a);
    await add(tenants.a, customerId, home);
    const before = await add(tenants.a, customerId, office);
    const res = await request(server)
      .patch(`${addressesOf(customerId)}/${idOf(before, '2 Office Lane')}`)
      .set(as(tenants.a))
      .send({ isDefault: true })
      .expect(200);
    expect(lines(res.body as CustomerDetail)).toEqual(['2 Office Lane (default)', '1 Lake Road']);

    // Asking again for the address that already is the default changes nothing.
    const again = await request(server)
      .patch(`${addressesOf(customerId)}/${idOf(before, '2 Office Lane')}`)
      .set(as(tenants.a))
      .send({ isDefault: true })
      .expect(200);
    expect(lines(again.body as CustomerDetail)).toEqual(['2 Office Lane (default)', '1 Lake Road']);
  });

  it('keeps exactly one default when two requests set different defaults at once', async () => {
    const customerId = await newCustomer(tenants.a);
    await add(tenants.a, customerId, home);
    await add(tenants.a, customerId, office);
    const customer = await add(tenants.a, customerId, shop);
    const makeDefault = (line1: string) =>
      request(server)
        .patch(`${addressesOf(customerId)}/${idOf(customer, line1)}`)
        .set(as(tenants.a))
        .send({ isDefault: true });

    const results = await Promise.all([makeDefault('2 Office Lane'), makeDefault('3 Shop Street')]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await activeDefaults(customerId)).toBe(1);
  });

  it('refuses isDefault: false with a plain explanation', async () => {
    const customerId = await newCustomer(tenants.a);
    const customer = await add(tenants.a, customerId, home);
    const res = await request(server)
      .patch(`${addressesOf(customerId)}/${idOf(customer, '1 Lake Road')}`)
      .set(as(tenants.a))
      .send({ isDefault: false })
      .expect(400);
    expect(res.body).toMatchObject({
      fieldErrors: { isDefault: 'To change the default, make another address the default.' },
    });
  });

  it('asks for at least one change, and refuses to blank a required field', async () => {
    const customerId = await newCustomer(tenants.a);
    const customer = await add(tenants.a, customerId, home);
    const path = `${addressesOf(customerId)}/${idOf(customer, '1 Lake Road')}`;
    const empty = await request(server).patch(path).set(as(tenants.a)).send({}).expect(400);
    expect(empty.body).toMatchObject({ message: 'Change at least one field.' });
    const blank = await request(server)
      .patch(path)
      .set(as(tenants.a))
      .send({ addressLine1: ' ' })
      .expect(400);
    expect(blank.body).toMatchObject({ fieldErrors: { addressLine1: 'Enter the address.' } });
  });

  it('refuses to edit an archived address', async () => {
    const customerId = await newCustomer(tenants.a);
    await add(tenants.a, customerId, home);
    const customer = await add(tenants.a, customerId, office);
    const path = `${addressesOf(customerId)}/${idOf(customer, '2 Office Lane')}`;
    await request(server).post(`${path}/archive`).set(as(tenants.a)).expect(200);
    const res = await request(server)
      .patch(path)
      .set(as(tenants.a))
      .send({ label: 'Old' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'ADDRESS_ARCHIVED' });
  });
});

describe('POST /customers/:id/addresses/:addressId/archive', () => {
  it('archiving the default passes it to the oldest remaining address', async () => {
    const customerId = await newCustomer(tenants.a);
    await add(tenants.a, customerId, home);
    await add(tenants.a, customerId, office);
    const customer = await add(tenants.a, customerId, { ...shop, isDefault: true });

    const res = await request(server)
      .post(`${addressesOf(customerId)}/${idOf(customer, '3 Shop Street')}/archive`)
      .set(as(tenants.a))
      .expect(200);
    expect(lines(res.body as CustomerDetail)).toEqual(['1 Lake Road (default)', '2 Office Lane']);
    const row = await prisma.customerAddress.findUniqueOrThrow({
      where: { id: idOf(customer, '3 Shop Street') },
    });
    expect(row).toMatchObject({ isDefault: false, archivedAt: expect.any(Date) as Date });
  });

  it('archiving the last address leaves none, and repeating it is harmless', async () => {
    const customerId = await newCustomer(tenants.a);
    const customer = await add(tenants.a, customerId, home);
    const path = `${addressesOf(customerId)}/${idOf(customer, '1 Lake Road')}/archive`;
    const first = await request(server).post(path).set(as(tenants.a)).expect(200);
    expect((first.body as CustomerDetail).addresses).toEqual([]);
    const archivedAt = (
      await prisma.customerAddress.findUniqueOrThrow({
        where: { id: idOf(customer, '1 Lake Road') },
      })
    ).archivedAt;

    await request(server).post(path).set(as(tenants.a)).expect(200);
    const after = await prisma.customerAddress.findUniqueOrThrow({
      where: { id: idOf(customer, '1 Lake Road') },
    });
    expect(after.archivedAt).toEqual(archivedAt);

    // A new address after that becomes the default again.
    expect(lines(await add(tenants.a, customerId, office))).toEqual(['2 Office Lane (default)']);
  });
});

describe('archived customers', () => {
  it('refuses every address change with CUSTOMER_ARCHIVED', async () => {
    const customerId = await newCustomer(tenants.a);
    const customer = await add(tenants.a, customerId, home);
    const addressPath = `${addressesOf(customerId)}/${idOf(customer, '1 Lake Road')}`;
    await request(server).post(`${CUSTOMERS}/${customerId}/archive`).set(as(tenants.a)).expect(200);

    const calls = [
      request(server).post(addressesOf(customerId)).set(as(tenants.a)).send(office),
      request(server).patch(addressPath).set(as(tenants.a)).send({ label: 'New' }),
      request(server).post(`${addressPath}/archive`).set(as(tenants.a)),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'CUSTOMER_ARCHIVED' });
    }
  });
});

describe('isolation (basic; full sweep in B5)', () => {
  it("answers another business's customer or address with the standard 404", async () => {
    const customerOfB = await newCustomer(tenants.b, 'Private To B Demo');
    const addressOfB = idOf(await add(tenants.b, customerOfB, home), '1 Lake Road');
    const customerOfA = await newCustomer(tenants.a);

    const routes = [
      { method: 'post' as const, path: (id: string) => addressesOf(id), body: office },
      {
        method: 'patch' as const,
        path: (id: string) => `${addressesOf(id)}/${addressOfB}`,
        body: { label: 'Taken' },
      },
      { method: 'post' as const, path: (id: string) => `${addressesOf(id)}/${addressOfB}/archive` },
    ];
    for (const route of routes) await expectCrossTenant404(server, tenants.a, route, customerOfB);

    // B's address under A's own customer: also the standard 404.
    await expectCrossTenant404(
      server,
      tenants.a,
      {
        method: 'patch',
        path: (id) => `${addressesOf(customerOfA)}/${id}`,
        body: { label: 'Taken' },
      },
      addressOfB,
    );
    await expectCrossTenant404(
      server,
      tenants.a,
      { method: 'post', path: (id) => `${addressesOf(customerOfA)}/${id}/archive` },
      addressOfB,
    );

    const row = await prisma.customerAddress.findUniqueOrThrow({ where: { id: addressOfB } });
    expect(row).toMatchObject({ label: 'Home', isDefault: true, archivedAt: null });
    expect(await prisma.customerAddress.count({ where: { customerId: customerOfB } })).toBe(1);
  });

  it('does not let an address be reached through another customer of the same business', async () => {
    const owner = await newCustomer(tenants.a, 'Owner Demo');
    const other = await newCustomer(tenants.a, 'Other Demo');
    const addressId = idOf(await add(tenants.a, owner, home), '1 Lake Road');
    const res = await request(server)
      .patch(`${addressesOf(other)}/${addressId}`)
      .set(as(tenants.a))
      .send({ label: 'Moved' })
      .expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    await request(server)
      .post(`${addressesOf(other)}/${addressId}/archive`)
      .set(as(tenants.a))
      .expect(404);
  });
});
