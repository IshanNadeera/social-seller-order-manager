// GET /orders against the real database (docs/DEVELOPMENT.md §6.3, §9.5, ADR-015, task C9).
// Run with: npm run test:db -w apps/api. Fake data only.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { OrderSummary, Page } from '@ssom/shared';
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

let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let tenants: TwoTenants;
let seq = 0;

interface Seed {
  createdAt: string;
  orderStatus?: 'NEW' | 'READY' | 'COMPLETED' | 'CANCELLED';
  paymentStatus?: 'UNPAID' | 'PAID';
  sourceChannel?: 'WHATSAPP' | 'FACEBOOK' | 'WALK_IN';
  delivery?: 'PENDING' | 'DISPATCHED';
  customerId?: string;
  name?: string;
  phone?: string | null;
  tenant?: Tenant;
}

/** Inserts an order directly (creation itself is tested in orders-create.db-spec.ts). */
async function seed(order: Seed): Promise<string> {
  seq += 1;
  const tenant = order.tenant ?? tenants.a;
  const isDelivery = order.delivery !== undefined;
  const row = await prisma.order.create({
    data: {
      businessId: tenant.businessId,
      orderNumber: `TNA-${String(seq).padStart(4, '0')}`,
      customerId: order.customerId ?? null,
      sourceChannel: order.sourceChannel ?? (order.customerId ? 'WHATSAPP' : 'WALK_IN'),
      fulfilmentType: isDelivery ? 'DELIVERY' : 'PICKUP',
      orderStatus: order.orderStatus ?? 'NEW',
      paymentStatus: order.paymentStatus ?? 'UNPAID',
      paymentMethod: 'CASH',
      currency: 'LKR',
      subtotal: '1000.00',
      totalAmount: '1000.00',
      amountPaid: order.paymentStatus === 'PAID' ? '1000.00' : '0.00',
      customerNameSnapshot: order.name ?? 'Walk-in customer',
      customerPhoneSnapshot: order.phone ?? null,
      createdById: tenant.userId,
      createdAt: new Date(order.createdAt),
    },
    select: { id: true },
  });
  if (isDelivery) {
    await prisma.delivery.create({
      data: {
        businessId: tenant.businessId,
        orderId: row.id,
        status: order.delivery,
        recipientName: 'Demo',
        phone: '0770000000',
        addressLine1: '1 Demo Lane',
      },
    });
  }
  return row.id;
}

const list = async (query: Record<string, string> = {}, tenant: Tenant = tenants.a) => {
  const res = await request(server)
    .get(PATH)
    .query(query)
    .set('Authorization', `Bearer ${tenant.token}`)
    .expect(200);
  return res.body as Page<OrderSummary>;
};
const numbers = (page: Page<OrderSummary>) => page.items.map((item) => item.orderNumber);

let ids: Record<string, string>;

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

  const nimali = await prisma.customer.create({
    data: {
      businessId: tenants.a.businessId,
      name: 'Nimali Demo',
      phoneDisplay: '077 123 4567',
      phoneNormalized: '+94771234567',
    },
  });
  ids = {
    // 23:59:59 on 31 Oct in Colombo.
    lateOct31: await seed({ createdAt: '2026-10-31T18:29:59.000Z' }),
    // 00:00:00 on 1 Nov in Colombo.
    nov1: await seed({
      createdAt: '2026-10-31T18:30:00.000Z',
      customerId: nimali.id,
      name: 'Nimali Demo',
      phone: '077 123 4567',
      delivery: 'DISPATCHED',
      orderStatus: 'READY',
    }),
    ready: await seed({
      createdAt: '2026-11-01T06:00:00.000Z',
      orderStatus: 'READY',
      delivery: 'PENDING',
      sourceChannel: 'FACEBOOK',
      customerId: nimali.id,
      name: 'Nimali Demo',
    }),
    paid: await seed({
      createdAt: '2026-11-01T07:00:00.000Z',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
    }),
    cancelled: await seed({ createdAt: '2026-11-01T07:00:00.000Z', orderStatus: 'CANCELLED' }),
  };
  await seed({
    createdAt: '2026-11-01T08:00:00.000Z',
    tenant: tenants.b,
    name: 'Other Business Demo',
  });
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

describe('GET /orders', () => {
  it('lists newest first (ties by ID), only this business, with a masked phone and the stage', async () => {
    const page = await list();
    expect(page.total).toBe(5);
    const createdAt = page.items.map((item) => item.createdAt);
    expect(createdAt).toEqual([...createdAt].sort().reverse());
    const [tieA, tieB] = page.items.filter((item) => item.createdAt === '2026-11-01T07:00:00.000Z');
    expect(tieA && tieB && tieA.id > tieB.id).toBe(true);
    expect(page.items.find((item) => item.id === ids.nov1)).toMatchObject({
      customerName: 'Nimali Demo',
      customerPhoneMasked: '077 ••• 4567',
      stage: 'OUT_FOR_DELIVERY',
      deliveryStatus: 'DISPATCHED',
      totalAmount: '1000.00',
      balanceDue: '1000.00',
    });
    expect(page.items.find((item) => item.id === ids.cancelled)).toMatchObject({
      balanceDue: '0.00',
    });
    expect(page.items.map((item) => item.customerName)).not.toContain('Other Business Demo');
  });

  it('pages without overlap', async () => {
    const first = await list({ pageSize: '2' });
    const second = await list({ pageSize: '2', page: '2' });
    const third = await list({ pageSize: '2', page: '3' });
    const all = [...numbers(first), ...numbers(second), ...numbers(third)];
    expect(new Set(all).size).toBe(5);
  });

  it('filters by order, payment and delivery status and by source', async () => {
    expect((await list({ orderStatus: 'READY' })).total).toBe(2);
    expect((await list({ paymentStatus: 'PAID' })).items.map((item) => item.id)).toEqual([
      ids.paid,
    ]);
    expect((await list({ deliveryStatus: 'DISPATCHED' })).items.map((item) => item.id)).toEqual([
      ids.nov1,
    ]);
    expect((await list({ sourceChannel: 'FACEBOOK' })).items.map((item) => item.id)).toEqual([
      ids.ready,
    ]);
    expect(
      (await list({ orderStatus: 'READY', deliveryStatus: 'PENDING' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([ids.ready]);
  });

  it('uses local Colombo dates: to=31 Oct includes 23:59:59, from=1 Nov starts at local midnight', async () => {
    const oct = await list({ from: '2026-10-31', to: '2026-10-31' });
    expect(oct.items.map((item) => item.id)).toEqual([ids.lateOct31]);
    const nov = await list({ from: '2026-11-01', to: '2026-11-01' });
    expect(nov.total).toBe(4);
    expect(nov.items.map((item) => item.id)).not.toContain(ids.lateOct31);
  });

  it('searches the order number, customer name and phone (any format)', async () => {
    const byNumber = await list({ q: 'tna-0002' });
    expect(byNumber.items.map((item) => item.id)).toEqual([ids.nov1]);
    expect((await list({ q: 'nimali' })).total).toBe(2);
    // The normalised phone of the linked customer, typed another way.
    expect((await list({ q: '+94 77 123 4567' })).total).toBe(2);
    expect((await list({ q: '_' })).total).toBe(0);
  });

  it('refuses bad queries: page size over 100, bad dates, ranges over 366 days, unknown filters', async () => {
    const bad = async (query: Record<string, string>) => {
      const res = await request(server)
        .get(PATH)
        .query(query)
        .set('Authorization', `Bearer ${tenants.a.token}`)
        .expect(400);
      return res.body as { fieldErrors: Record<string, string> };
    };
    expect((await bad({ pageSize: '101' })).fieldErrors).toEqual({ pageSize: 'Use at most 100.' });
    expect((await bad({ from: '2026-13-01' })).fieldErrors.from).toContain('YYYY-MM-DD');
    expect((await bad({ from: '2025-01-01', to: '2026-01-02' })).fieldErrors).toEqual({
      to: 'Choose a range of at most 366 days.',
    });
    expect((await bad({ businessId: tenants.b.businessId })).fieldErrors).toEqual({
      businessId: 'This field is not allowed.',
    });
  });
});
