// Payment status and cached sums on orders (docs/DEVELOPMENT.md §7.6, ADR-006).
import type { PaymentStatus } from '@ssom/shared';
import Decimal from 'decimal.js';
import { notFound } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/**
 * §7.6, in this order:
 *   paid = 0                       → UNPAID
 *   refunded > 0 and net = 0       → REFUNDED
 *   refunded > 0                   → PARTIALLY_REFUNDED
 *   net ≥ total                    → PAID
 *   otherwise                      → PARTIALLY_PAID
 * Amounts are decimal strings ("1500.00").
 */
export function paymentStatusFor(total: string, paid: string, refunded: string): PaymentStatus {
  const paidAmount = new Decimal(paid);
  const refundedAmount = new Decimal(refunded);
  const net = paidAmount.minus(refundedAmount);
  if (paidAmount.isZero()) return 'UNPAID';
  if (refundedAmount.greaterThan(0)) return net.isZero() ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  return net.greaterThanOrEqualTo(total) ? 'PAID' : 'PARTIALLY_PAID';
}

export interface PaymentSummary {
  amountPaid: string;
  amountRefunded: string;
  paymentStatus: PaymentStatus;
}

/**
 * Recalculates an order's amount_paid, amount_refunded and payment_status FROM the payments table:
 * never incremented, so the cache can't drift (ADR-006). Run it inside the same transaction as any
 * payment, refund or total change. It locks the order row first (SELECT … FOR UPDATE), so concurrent
 * changes to one order run one after another (§7.6). Scoped to the caller's business.
 */
export async function recalculatePaymentSummary(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  orderId: string,
): Promise<PaymentSummary> {
  const locked = await tx.$queryRaw<{ total_amount: Prisma.Decimal }[]>`
    SELECT total_amount FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid AND id = ${orderId}::uuid
    FOR UPDATE`;
  const [order] = locked;
  if (order === undefined) throw notFound();

  const sums = await tx.payment.groupBy({
    by: ['type'],
    where: { businessId: scope.businessId, orderId },
    _sum: { amount: true },
  });
  const sumOf = (type: 'PAYMENT' | 'REFUND') =>
    (sums.find((row) => row.type === type)?._sum.amount ?? new Decimal(0)).toFixed(2);

  const summary: PaymentSummary = {
    amountPaid: sumOf('PAYMENT'),
    amountRefunded: sumOf('REFUND'),
    paymentStatus: 'UNPAID',
  };
  summary.paymentStatus = paymentStatusFor(
    order.total_amount.toString(),
    summary.amountPaid,
    summary.amountRefunded,
  );

  await tx.order.updateMany({
    where: { businessId: scope.businessId, id: orderId },
    data: summary,
  });
  return summary;
}
