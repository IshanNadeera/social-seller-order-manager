// Order number allocation against the real database (docs/DEVELOPMENT.md §7.12, §12.2, task C5).
// Run with: npm run test:db -w apps/api
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { allocateOrderNumber } from '../src/orders/order-number';
import { createTestAuth } from './test-auth';
import { createTwoTenants } from './tenant-isolation';
import type { TwoTenants } from './tenant-isolation';

let prisma: PrismaService;
let tenants: TwoTenants;

beforeAll(async () => {
  const env = parseEnv(process.env);
  prisma = new PrismaService(env);
  tenants = await createTwoTenants(prisma, await createTestAuth(env.SUPABASE_JWT_ISSUER));
});

afterAll(async () => {
  await tenants.cleanup();
  await prisma.$disconnect();
});

// 20 transactions share a pool of 5 connections (§8.4), so allow time to queue for one.
const allocate = (businessId: string) =>
  prisma.$transaction((tx) => allocateOrderNumber(tx, { businessId }), { maxWait: 15_000 });

describe('allocateOrderNumber', () => {
  it('formats PREFIX-0001 and counts up', async () => {
    expect(await allocate(tenants.a.businessId)).toEqual({ sequence: 1, orderNumber: 'TNA-0001' });
    expect(await allocate(tenants.a.businessId)).toEqual({ sequence: 2, orderNumber: 'TNA-0002' });
  });

  it('gives 20 concurrent creations 20 unique, sequential numbers', async () => {
    const before = await prisma.businessCounter.findUniqueOrThrow({
      where: { businessId: tenants.b.businessId },
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => allocate(tenants.b.businessId)),
    );
    const sequences = results.map((result) => result.sequence).sort((x, y) => x - y);
    const first = before.nextOrderSeq;
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, index) => first + index));
    expect(new Set(results.map((result) => result.orderNumber)).size).toBe(20);
    const after = await prisma.businessCounter.findUniqueOrThrow({
      where: { businessId: tenants.b.businessId },
    });
    expect(after.nextOrderSeq).toBe(first + 20);
  });

  it('keeps each business on its own counter', async () => {
    const a = await allocate(tenants.a.businessId);
    const b = await allocate(tenants.b.businessId);
    expect(a.orderNumber.startsWith('TNA-')).toBe(true);
    expect(b.orderNumber.startsWith('TNB-')).toBe(true);
  });

  it('does not use the number when the transaction rolls back (a gap, never a duplicate)', async () => {
    const { sequence: last } = await allocate(tenants.a.businessId);
    await expect(
      prisma.$transaction(async (tx) => {
        await allocateOrderNumber(tx, { businessId: tenants.a.businessId });
        throw new Error('order insert failed');
      }),
    ).rejects.toThrow('order insert failed');
    expect((await allocate(tenants.a.businessId)).sequence).toBe(last + 1);
  });

  it('uses the new prefix for new orders only, and pads beyond 4 digits', async () => {
    await prisma.business.update({
      where: { id: tenants.a.businessId },
      data: { orderPrefix: 'NEW' },
    });
    await prisma.businessCounter.update({
      where: { businessId: tenants.a.businessId },
      data: { nextOrderSeq: 12345 },
    });
    expect(await allocate(tenants.a.businessId)).toEqual({
      sequence: 12345,
      orderNumber: 'NEW-12345',
    });
  });

  it('fails loudly for a business without a counter', async () => {
    await expect(allocate('00000000-0000-4000-8000-00000000dead')).rejects.toThrow(
      'No order counter for this business.',
    );
  });
});
