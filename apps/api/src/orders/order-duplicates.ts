// Possible duplicate orders (docs/DEVELOPMENT.md §2.2): an order for the same customer phone with a
// similar total, made in the last 30 minutes. Sellers copy orders from chats, so the same order is
// easily entered twice; the form warns, and the seller decides. Nothing is ever blocked.
import {
  DUPLICATE_MAX_RESULTS,
  DUPLICATE_TOTAL_TOLERANCE,
  DUPLICATE_WINDOW_MINUTES,
  cents,
  orderStage,
} from '@ssom/shared';
import type { DuplicateCheckQuery, PossibleDuplicate } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import type { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantWhere } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/** Recent orders read before the totals are compared (30 minutes rarely holds more). */
const CANDIDATES = 50;
/** The tolerance as a whole-number percentage, for exact BigInt arithmetic. */
const TOLERANCE_PERCENT = BigInt(Math.round(DUPLICATE_TOTAL_TOLERANCE * 100));

/** True when the totals differ by at most the tolerance, measured against the larger one. */
export function similarTotals(a: bigint, b: bigint): boolean {
  const larger = a > b ? a : b;
  const difference = a > b ? a - b : b - a;
  return difference * 100n <= larger * TOLERANCE_PERCENT;
}

export async function possibleDuplicates(
  prisma: PrismaService,
  auth: AuthContext,
  query: DuplicateCheckQuery,
  now: Date = new Date(),
): Promise<PossibleDuplicate[]> {
  // Another business's customer is "not found", as everywhere else (§12.4).
  const customer = orNotFound(
    await prisma.customer.findFirst({
      where: tenantWhere(auth, { id: query.customerId }),
      select: { id: true, phoneNormalized: true },
    }),
  );
  // The same phone may be on more than one customer record (entered twice); a customer without a
  // phone can only match their own orders.
  const sameCustomer: Prisma.OrderWhereInput =
    customer.phoneNormalized === null
      ? { customerId: customer.id }
      : {
          OR: [
            { customerId: customer.id },
            { customer: { phoneNormalized: customer.phoneNormalized } },
          ],
        };
  const recent = await prisma.order.findMany({
    where: tenantWhere(auth, {
      ...sameCustomer,
      orderStatus: { not: 'CANCELLED' },
      createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000) },
    } satisfies Prisma.OrderWhereInput),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CANDIDATES,
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      totalAmount: true,
      orderStatus: true,
      delivery: { select: { status: true } },
    },
  });
  const total = cents(query.total);
  return recent
    .filter((order) => similarTotals(cents(order.totalAmount.toFixed(2)), total))
    .slice(0, DUPLICATE_MAX_RESULTS)
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt.toISOString(),
      totalAmount: order.totalAmount.toFixed(2),
      stage: orderStage(order.orderStatus, order.delivery?.status ?? null),
    }));
}
