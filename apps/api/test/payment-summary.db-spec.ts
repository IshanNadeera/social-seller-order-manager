// recalculatePaymentSummary against the real database (docs/DEVELOPMENT.md §7.6, task C7).
// Run with: npm run test:db -w apps/api
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { recalculatePaymentSummary } from '../src/payments/payment-summary';
import { createTestAuth } from './test-auth';
import { createTwoTenants } from './tenant-isolation';
import type { TwoTenants } from './tenant-isolation';

let prisma: PrismaService;
let tenants: TwoTenants;
let seq = 0;

beforeAll(async () => {
  const env = parseEnv(process.env);
  prisma = new PrismaService(env);
  tenants = await createTwoTenants(prisma, await createTestAuth(env.SUPABASE_JWT_ISSUER));
});

afterAll(async () => {
  await tenants.cleanup();
  await prisma.$disconnect();
});

/** An anonymous walk-in pickup order of 1000.00 (no customer needed). */
async function newOrder(businessId = tenants.a.businessId): Promise<string> {
  seq += 1;
  const order = await prisma.order.create({
    data: {
      businessId,
      orderNumber: `PAY-${String(seq).padStart(4, '0')}`,
      sourceChannel: 'WALK_IN',
      fulfilmentType: 'PICKUP',
      paymentMethod: 'CASH',
      currency: 'LKR',
      subtotal: '1000.00',
      totalAmount: '1000.00',
      customerNameSnapshot: 'Walk-in customer',
      createdById: tenants.a.userId,
    },
    select: { id: true },
  });
  return order.id;
}

async function record(orderId: string, type: 'PAYMENT' | 'REFUND', amount: string) {
  await prisma.payment.create({
    data: {
      businessId: tenants.a.businessId,
      orderId,
      type,
      method: 'CASH',
      amount,
      recordedById: tenants.a.userId,
      occurredAt: new Date(),
    },
  });
}

const recalculate = (orderId: string, businessId = tenants.a.businessId) =>
  prisma.$transaction((tx) => recalculatePaymentSummary(tx, { businessId }, orderId));

const stored = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: { amountPaid: true, amountRefunded: true, paymentStatus: true },
  });

describe('recalculatePaymentSummary', () => {
  it('goes through all five statuses as payments and refunds are recorded', async () => {
    const id = await newOrder();
    const steps: [() => Promise<void>, string, string, string][] = [
      [async () => {}, '0.00', '0.00', 'UNPAID'],
      [() => record(id, 'PAYMENT', '400.00'), '400.00', '0.00', 'PARTIALLY_PAID'],
      [() => record(id, 'PAYMENT', '600.00'), '1000.00', '0.00', 'PAID'],
      [() => record(id, 'REFUND', '250.00'), '1000.00', '250.00', 'PARTIALLY_REFUNDED'],
      [() => record(id, 'REFUND', '750.00'), '1000.00', '1000.00', 'REFUNDED'],
    ];
    for (const [act, amountPaid, amountRefunded, paymentStatus] of steps) {
      await act();
      expect(await recalculate(id)).toEqual({ amountPaid, amountRefunded, paymentStatus });
      const row = await stored(id);
      expect([row.amountPaid.toFixed(2), row.amountRefunded.toFixed(2), row.paymentStatus]).toEqual([
        amountPaid,
        amountRefunded,
        paymentStatus,
      ]);
    }
  });

  it('recomputes from the payments table, so a wrong cached value is corrected (never incremented)', async () => {
    const id = await newOrder();
    await record(id, 'PAYMENT', '300.00');
    await prisma.order.update({
      where: { id },
      data: { amountPaid: '900.00', paymentStatus: 'PAID' },
    });
    expect(await recalculate(id)).toEqual({
      amountPaid: '300.00',
      amountRefunded: '0.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    // Running it again changes nothing.
    expect(await recalculate(id)).toMatchObject({ amountPaid: '300.00' });
  });

  it('locks the order row for the rest of the transaction', async () => {
    const id = await newOrder();
    let otherConnection: unknown = null;
    await prisma.$transaction(async (tx) => {
      await recalculatePaymentSummary(tx, { businessId: tenants.a.businessId }, id);
      // Another connection cannot take the same lock while this transaction is open.
      otherConnection = await prisma
        .$queryRaw`SELECT 1 FROM app.orders WHERE id = ${id}::uuid FOR UPDATE NOWAIT`
        .then(() => 'got the lock')
        .catch((error: unknown) => String(error));
    });
    expect(otherConnection).toMatch(/55P03|could not obtain lock/);
  });

  it("answers 404 for another business's order, and changes nothing", async () => {
    const id = await newOrder();
    await record(id, 'PAYMENT', '1000.00');
    await expect(recalculate(id, tenants.b.businessId)).rejects.toMatchObject({ status: 404 });
    expect((await stored(id)).paymentStatus).toBe('UNPAID');
  });
});
