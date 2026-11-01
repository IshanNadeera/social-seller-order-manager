// Runs the demo seed against the local database (docs/DEVELOPMENT.md §13.2).
// Needs: npm run db:start && npm run db:migrate -w apps/api. Run with: npm run test:db -w apps/api
// The demo rows are meant to stay in the local database afterwards; nothing else is written.
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_BUSINESS, DEMO_CUSTOMERS, DEMO_OWNER, DEMO_PRODUCTS } from '../prisma/demo-data';
import { assertSafeToSeed, seedDemoData } from '../prisma/seed-demo';
import { AppModule } from '../src/app.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';

describe('demo seed', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const env = parseEnv(process.env);
    assertSafeToSeed(env); // never run this test against a shared database
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  async function counts() {
    const businessId = DEMO_BUSINESS.id;
    return {
      owners: await prisma.businessMember.count({ where: { businessId, role: 'OWNER' } }),
      counters: await prisma.businessCounter.count({ where: { businessId } }),
      customers: await prisma.customer.count({ where: { businessId } }),
      addresses: await prisma.customerAddress.count({ where: { businessId } }),
      defaultAddresses: await prisma.customerAddress.count({
        where: { businessId, isDefault: true, archivedAt: null },
      }),
      products: await prisma.product.count({ where: { businessId } }),
      activeProducts: await prisma.product.count({ where: { businessId, archivedAt: null } }),
    };
  }

  const expected = {
    owners: 1,
    counters: 1,
    customers: DEMO_CUSTOMERS.length,
    addresses: DEMO_CUSTOMERS.flatMap((c) => c.addresses).length,
    defaultAddresses: DEMO_CUSTOMERS.filter((c) => c.addresses.some((a) => a.isDefault)).length,
    products: DEMO_PRODUCTS.length,
    activeProducts: DEMO_PRODUCTS.filter((p) => !p.archived).length,
  };

  it('creates the demo business, owner, customers, addresses and products', async () => {
    await seedDemoData(prisma);
    expect(await counts()).toEqual(expected);

    const business = await prisma.business.findUniqueOrThrow({ where: { id: DEMO_BUSINESS.id } });
    expect(business.orderPrefix).toBe(DEMO_BUSINESS.orderPrefix);
    expect(business.defaultDeliveryFee.toFixed(2)).toBe(DEMO_BUSINESS.defaultDeliveryFee);
    const owner = await prisma.businessMember.findFirstOrThrow({
      where: { businessId: DEMO_BUSINESS.id, role: 'OWNER' },
    });
    expect(owner.userId).toBe(DEMO_OWNER.id);
  });

  it('is idempotent: running it again changes no counts', async () => {
    await seedDemoData(prisma);
    await seedDemoData(prisma);
    expect(await counts()).toEqual(expected);
  });

  it('never resets the order counter', async () => {
    const before = await prisma.businessCounter.findUniqueOrThrow({
      where: { businessId: DEMO_BUSINESS.id },
    });
    await prisma.businessCounter.update({
      where: { businessId: DEMO_BUSINESS.id },
      data: { nextOrderSeq: 42 },
    });
    try {
      await seedDemoData(prisma);
      const counter = await prisma.businessCounter.findUniqueOrThrow({
        where: { businessId: DEMO_BUSINESS.id },
      });
      expect(counter.nextOrderSeq).toBe(42);
    } finally {
      await prisma.businessCounter.update({
        where: { businessId: DEMO_BUSINESS.id },
        data: { nextOrderSeq: before.nextOrderSeq },
      });
    }
  });
});
