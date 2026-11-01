// Demo seed logic, kept apart from seed.ts so it can be tested. See docs/DEVELOPMENT.md §13.2.
import type { Env } from '../src/common/env';
import type { PrismaClient } from '../src/generated/prisma/client';
import { DEMO_BUSINESS, DEMO_CUSTOMERS, DEMO_OWNER, DEMO_PRODUCTS } from './demo-data';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/**
 * Refuses to seed production, and any database that is not on this machine unless
 * SEED_ALLOW_REMOTE=true is set on purpose (for a staging project with fake data only, §13.2).
 */
export function assertSafeToSeed(
  env: Pick<Env, 'NODE_ENV' | 'DATABASE_URL'>,
  allowRemote = process.env.SEED_ALLOW_REMOTE === 'true',
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV is production. Demo data never goes into production.',
    );
  }
  const host = new URL(env.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host) && !allowRemote) {
    throw new Error(
      'Refusing to seed: DATABASE_URL is not a local database. To seed a staging project with fake ' +
        'data, set SEED_ALLOW_REMOTE=true for this one command.',
    );
  }
}

export interface SeedSummary {
  businessId: string;
  customers: number;
  addresses: number;
  products: number;
}

/**
 * Creates or refreshes the demo business, its owner, customers, addresses and products in one
 * transaction. Safe to run repeatedly. Never touches the order counter once it exists, so order
 * numbers already issued stay unique.
 */
export async function seedDemoData(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(async (tx) => {
    const { id: userId, ...owner } = DEMO_OWNER;
    await tx.user.upsert({
      where: { id: userId },
      create: { id: userId, ...owner },
      update: owner,
    });

    const { id: businessId, ...business } = DEMO_BUSINESS;
    await tx.business.upsert({
      where: { id: businessId },
      create: { id: businessId, ...business },
      update: { ...business, archivedAt: null },
    });
    await tx.businessCounter.upsert({
      where: { businessId },
      create: { businessId, nextOrderSeq: 1 },
      update: {},
    });
    await tx.businessMember.upsert({
      where: { businessId_userId: { businessId, userId } },
      create: { businessId, userId, role: 'OWNER' },
      update: { role: 'OWNER' },
    });

    let addresses = 0;
    for (const { id: customerId, addresses: customerAddresses, ...customer } of DEMO_CUSTOMERS) {
      await tx.customer.upsert({
        where: { id: customerId },
        create: { id: customerId, businessId, ...customer },
        update: { ...customer, archivedAt: null },
      });
      // Clear the default first so the "one default address per customer" index is never violated mid-update.
      await tx.customerAddress.updateMany({
        where: { businessId, customerId },
        data: { isDefault: false },
      });
      for (const { id: addressId, ...addressData } of customerAddresses) {
        await tx.customerAddress.upsert({
          where: { id: addressId },
          create: { id: addressId, businessId, customerId, ...addressData },
          update: { ...addressData, archivedAt: null },
        });
        addresses++;
      }
    }

    // Clear SKUs first so swapping SKUs between demo products can never hit the unique SKU index.
    await tx.product.updateMany({
      where: { businessId, id: { in: DEMO_PRODUCTS.map((p) => p.id) } },
      data: { sku: null },
    });
    for (const { id: productId, archived, ...productData } of DEMO_PRODUCTS) {
      const data = {
        ...productData,
        archivedAt: archived ? new Date('2026-01-01T00:00:00Z') : null,
      };
      await tx.product.upsert({
        where: { id: productId },
        create: { id: productId, businessId, ...data },
        update: data,
      });
    }

    return {
      businessId,
      customers: DEMO_CUSTOMERS.length,
      addresses,
      products: DEMO_PRODUCTS.length,
    };
  });
}
