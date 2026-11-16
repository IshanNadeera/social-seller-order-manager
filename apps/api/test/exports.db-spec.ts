// GET /exports/orders.csv against the real database (docs/DEVELOPMENT.md §9.4, §11.4, task E4):
// tenant-scoped, the orders list's filters, stage labels from shared, formula-injection escaping,
// and at most 10 exports an hour per business. Run with: npm run test:db -w apps/api.
// Fake data only.
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { EXPORTS_PER_HOUR, ORDER_STAGE_LABELS } from '@ssom/shared';
import type { OrderDetail } from '@ssom/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { ExportLimit } from '../src/exports/export-limit';
import { ORDER_CSV_COLUMNS } from '../src/exports/exports.service';
import { createTestAuth } from './test-auth';
import { createTwoTenants } from './tenant-isolation';
import type { Tenant, TwoTenants } from './tenant-isolation';

const API = '/api/v1';
const O = `${API}/orders`;
const ADDRESS = {
  recipientName: 'Csv Demo',
  phone: '0771234567',
  addressLine1: '12, Lake Road',
  city: 'Kandy',
};

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let a: { delivery: OrderDetail; pickup: OrderDetail; cancelled: OrderDetail };
let b: OrderDetail;

const as = (tenant: Tenant) => ({ Authorization: `Bearer ${tenant.token}` });
const post = (tenant: Tenant, path: string, body: object) =>
  request(server).post(path).set(as(tenant)).set('Idempotency-Key', randomUUID()).send(body);
const exportCsv = (tenant: Tenant, query: Record<string, string> = {}) =>
  request(server).get(`${API}/exports/orders.csv`).query(query).set(as(tenant));

/** RFC 4180 parsing, enough to read the file back: rows of cells, header row first. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') ((cell += '"'), (i += 1));
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') (row.push(cell), (cell = ''));
    else if (char === '\r' && body[i + 1] === '\n') {
      (row.push(cell), rows.push(row), (row = []), (cell = ''), (i += 1));
    } else cell += char;
  }
  return rows;
}

/** A file's rows as records keyed by column name. */
function rowsOf(text: string) {
  const [header = [], ...rows] = parseCsv(text);
  expect(header).toEqual([...ORDER_CSV_COLUMNS]);
  return rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

/** One export as records. Each call is an export: business A may make 10 in this file. */
async function records(tenant: Tenant, query: Record<string, string> = {}) {
  return rowsOf((await exportCsv(tenant, query).expect(200)).text);
}

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

  const A = tenants.a;
  // Text a spreadsheet would run as a formula, as a customer could type it.
  const customer = await prisma.customer.create({
    data: {
      businessId: A.businessId,
      name: '=HYPERLINK("http://x.test","Click")',
      // Orders copy phoneDisplay into their phone snapshot.
      phoneDisplay: '+94771234567',
      phoneNormalized: '+94771234567',
    },
  });
  const delivery = (
    await post(A, O, {
      sourceChannel: 'WHATSAPP',
      customerId: customer.id,
      items: [
        { name: 'Silk Saree', quantity: 2, unitPrice: '1000' },
        { name: 'Gift wrap', quantity: 1, unitPrice: '200' },
      ],
      deliveryFee: '350',
      paymentMethod: 'COD',
      delivery: ADDRESS,
      notes: '@SUM(1+1) and a "quote"',
    }).expect(201)
  ).body as OrderDetail;
  const pickup = (
    await post(A, O, {
      sourceChannel: 'INSTAGRAM',
      customerId: customer.id,
      fulfilmentType: 'PICKUP',
      items: [{ name: 'Scarf', quantity: 1, unitPrice: '500' }],
      paymentMethod: 'CASH',
      initialPayment: { amount: '200' },
    }).expect(201)
  ).body as OrderDetail;
  const cancelled = (
    await post(A, O, {
      sourceChannel: 'INSTAGRAM',
      customerId: customer.id,
      fulfilmentType: 'PICKUP',
      items: [{ name: 'Scarf', quantity: 1, unitPrice: '500' }],
      paymentMethod: 'CASH',
      initialPayment: { amount: '100' },
    }).expect(201)
  ).body as OrderDetail;
  await post(A, `${O}/${cancelled.id}/cancel`, { reason: 'Changed mind' }).expect(200);
  a = { delivery, pickup, cancelled };

  const theirs = await prisma.customer.create({
    data: { businessId: tenants.b.businessId, name: 'Bravo Customer' },
  });
  b = (
    await post(tenants.b, O, {
      sourceChannel: 'WHATSAPP',
      customerId: theirs.id,
      fulfilmentType: 'PICKUP',
      items: [{ name: 'Their item', quantity: 1, unitPrice: '9000' }],
      paymentMethod: 'CASH',
    }).expect(201)
  ).body as OrderDetail;
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /exports/orders.csv (§9.4)', () => {
  it('is a UTF-8 CSV download of the business’s own orders, newest first', async () => {
    const res = await exportCsv(tenants.a).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.startsWith('﻿')).toBe(true);

    const rows = rowsOf(res.text);
    expect(rows.map((row) => row['Order number'])).toEqual([
      a.cancelled.orderNumber,
      a.pickup.orderNumber,
      a.delivery.orderNumber,
    ]);
    expect(rows.map((row) => row['Order number'])).not.toContain(b.orderNumber);
  });

  it('writes each column, with stage labels from shared and money as plain decimals', async () => {
    const rows = await records(tenants.a);
    const delivery = rows.find((row) => row['Order number'] === a.delivery.orderNumber);
    expect(delivery).toMatchObject({
      Stage: ORDER_STAGE_LABELS.NEW,
      'Order status': 'NEW',
      'Payment status': 'UNPAID',
      'Delivery status': 'PENDING',
      Source: 'WHATSAPP',
      Fulfilment: 'DELIVERY',
      'Payment method': 'COD',
      Items: '2 × Silk Saree; 1 × Gift wrap',
      Subtotal: '2200.00',
      'Delivery fee': '350.00',
      Total: '2550.00',
      'Balance due': '2550.00',
      'Refund owed': '0.00',
      Recipient: 'Csv Demo',
      Address: '12, Lake Road',
      City: 'Kandy',
      'COD amount': '2550.00',
      'COD status': 'PENDING',
    });
    expect(delivery?.Created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const cancelled = rows.find((row) => row['Order number'] === a.cancelled.orderNumber);
    expect(cancelled).toMatchObject({
      Stage: ORDER_STAGE_LABELS.CANCELLED,
      'Delivery status': '',
      'Balance due': '0.00',
      'Refund owed': '100.00',
    });
  });

  it('escapes text a spreadsheet would run as a formula (§11.4)', async () => {
    const res = await exportCsv(tenants.a).expect(200);
    const rows = rowsOf(res.text);
    const delivery = rows.find((row) => row['Order number'] === a.delivery.orderNumber);
    expect(delivery?.Customer).toBe(`'=HYPERLINK("http://x.test","Click")`);
    expect(delivery?.['Customer phone']).toBe("'+94771234567");
    expect(delivery?.Notes).toBe(`'@SUM(1+1) and a "quote"`);
    // No cell in the raw file begins with a formula character.
    expect(res.text).not.toMatch(/(^|,|")[=+\-@]/m);
  });

  it('uses the orders list’s search and filters', async () => {
    const instagram = await records(tenants.a, { sourceChannel: 'INSTAGRAM' });
    expect(instagram.map((row) => row['Order number']).sort()).toEqual(
      [a.pickup.orderNumber, a.cancelled.orderNumber].sort(),
    );
    const cancelled = await records(tenants.a, { orderStatus: 'CANCELLED' });
    expect(cancelled.map((row) => row['Order number'])).toEqual([a.cancelled.orderNumber]);
    const found = await records(tenants.a, { q: a.delivery.orderNumber });
    expect(found.map((row) => row['Order number'])).toEqual([a.delivery.orderNumber]);
    expect(await records(tenants.a, { from: '2020-01-01', to: '2020-01-31' })).toEqual([]);
  });

  it('never includes another business’s orders, even when searched for', async () => {
    expect(await records(tenants.a, { q: b.orderNumber })).toEqual([]);
    const theirs = await records(tenants.b);
    expect(theirs.map((row) => row['Order number'])).toEqual([b.orderNumber]);
  });

  it.each([
    [{ orderStatus: 'LOST' }, 'orderStatus'],
    [{ from: '2026-10-31', to: '2026-10-01' }, 'to'],
    [{ page: '2' }, 'page'],
    [{ businessId: randomUUID() }, 'businessId'],
  ] as const)('refuses %o (400 on %s), and it doesn’t count as an export', async (query, field) => {
    const res = await exportCsv(tenants.a, query).expect(400);
    expect(Object.keys((res.body as { fieldErrors: object }).fieldErrors)).toContain(field);
  });

  it(`allows ${EXPORTS_PER_HOUR} exports an hour per business, then 429 with Retry-After`, async () => {
    const limit = app.get(ExportLimit);
    // Use up what is left of B's allowance (its earlier exports count too).
    let made = 0;
    while (limit.waitSeconds(tenants.b.businessId) === null) {
      await exportCsv(tenants.b).expect(200);
      made += 1;
      expect(made).toBeLessThanOrEqual(EXPORTS_PER_HOUR);
    }
    const refused = await exportCsv(tenants.b).expect(429);
    expect(refused.body).toMatchObject({ code: 'EXPORT_RATE_LIMITED' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // Business A has its own allowance.
    await exportCsv(tenants.a).expect(200);
  });
});
