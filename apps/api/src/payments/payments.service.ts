import { Injectable } from '@nestjs/common';
import { cents } from '@ssom/shared';
import type {
  CodStatus,
  Page,
  PaymentCreateInput,
  PaymentListQuery,
  PaymentRecorded,
  PaymentView,
} from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantData, tenantWhere } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { refuse } from '../orders/order-errors';
import { lockOrder } from '../orders/order-lock';
import { loadOrderDetail } from '../orders/order-view';
import { recalculatePaymentSummary } from './payment-summary';

type Tx = Prisma.TransactionClient;

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

const paymentSelect = {
  id: true,
  type: true,
  method: true,
  amount: true,
  occurredAt: true,
  createdAt: true,
  refundOfPaymentId: true,
  reference: true,
  notes: true,
  recordedBy: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

function toView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    type: row.type,
    method: row.method,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    refundOfPaymentId: row.refundOfPaymentId,
    reference: row.reference,
    notes: row.notes,
    recordedBy: { id: row.recordedBy.id, name: row.recordedBy.fullName ?? row.recordedBy.email },
  };
}

/**
 * Payments and refunds (docs/DEVELOPMENT.md §7.7, §7.8, ADR-014). Records are insert-only: there is
 * no update or delete. A mistake is corrected with a refund whose note says so.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /orders/:id/payments: the order's records, oldest first; 404 if the order isn't ours. */
  async list(
    auth: AuthContext,
    orderId: string,
    query: PaymentListQuery,
  ): Promise<Page<PaymentView>> {
    orNotFound(
      await this.prisma.order.findFirst({
        where: tenantWhere(auth, { id: orderId }),
        select: { id: true },
      }),
    );
    const where = tenantWhere(auth, { orderId });
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: paymentSelect,
      }),
    ]);
    return { items: rows.map(toView), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * POST /orders/:id/payments, in `tx` (the controller's idempotent transaction). The order row is
   * locked first, so two records for one order are checked one after the other (§7.6).
   */
  async record(
    tx: Tx,
    auth: AuthContext,
    orderId: string,
    input: PaymentCreateInput,
  ): Promise<PaymentRecorded> {
    await lockOrder(tx, auth, orderId);
    const order = await tx.order.findFirstOrThrow({
      where: tenantWhere(auth, { id: orderId }),
      select: {
        orderStatus: true,
        totalAmount: true,
        delivery: { select: { status: true, codAmount: true, codStatus: true } },
      },
    });

    // Net paid from the records themselves, not the cached sums (ADR-006).
    const sums = await tx.payment.groupBy({
      by: ['type'],
      where: tenantWhere(auth, { orderId }),
      _sum: { amount: true },
    });
    const sumOf = (type: 'PAYMENT' | 'REFUND') =>
      cents(sums.find((row) => row.type === type)?._sum.amount?.toFixed(2) ?? '0.00');
    const netPaid = sumOf('PAYMENT') - sumOf('REFUND');
    const total = cents(order.totalAmount.toFixed(2));
    const amount = cents(input.amount);
    const { delivery } = order;
    // A delivery whose COD money is still to come (not settled, not cancelled).
    const codDelivery =
      delivery !== null && (delivery.codStatus === 'PENDING' || delivery.codStatus === 'COLLECTED')
        ? delivery
        : null;

    if (input.type === 'PAYMENT') {
      if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED') {
        throw refuse(
          'ORDER_CLOSED',
          'This order is cancelled or returned, so it can’t take payments. You can still record a refund.',
          'type',
        );
      }
      // After dispatch the COD amount is frozen (§7.8): that money is still to come.
      const frozenCod =
        codDelivery !== null && codDelivery.status !== 'PENDING'
          ? cents(codDelivery.codAmount.toFixed(2))
          : 0n;
      const room = total - netPaid - frozenCod;
      if (amount > room) {
        throw refuse(
          'PAYMENT_EXCEEDS_BALANCE',
          frozenCod > 0n
            ? `This is more than is left to pay besides the cash on delivery (${fromCents(room < 0n ? 0n : room)}).`
            : `This is more than the balance due (${fromCents(room < 0n ? 0n : room)}).`,
          'amount',
        );
      }
    } else {
      if (amount > netPaid) {
        throw refuse(
          'REFUND_EXCEEDS_PAID',
          `A refund can’t be more than the customer has paid (${fromCents(netPaid < 0n ? 0n : netPaid)}).`,
          'amount',
        );
      }
      if (input.refundOfPaymentId !== undefined) {
        const target = await tx.payment.findFirst({
          where: tenantWhere(auth, {
            id: input.refundOfPaymentId,
            orderId,
            type: 'PAYMENT' as const,
          }),
          select: { id: true },
        });
        if (target === null) {
          throw refuse(
            'REFUND_TARGET_INVALID',
            'Choose one of this order’s payments.',
            'refundOfPaymentId',
          );
        }
      }
    }

    const payment = await tx.payment.create({
      data: tenantData(auth, {
        orderId,
        type: input.type,
        method: input.method,
        amount: input.amount,
        refundOfPaymentId: input.refundOfPaymentId ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: auth.userId,
        occurredAt: input.occurredAt === undefined ? new Date() : new Date(input.occurredAt),
      }),
      select: paymentSelect,
    });
    await recalculatePaymentSummary(tx, auth, orderId);

    // Before dispatch, COD follows the balance due (§7.8): a payment shrinks what the courier collects.
    let codChange: { amount: string; from: CodStatus; to: CodStatus } | null = null;
    if (input.type === 'PAYMENT' && codDelivery !== null && codDelivery.status === 'PENDING') {
      const balance = total - (netPaid + amount);
      if (cents(codDelivery.codAmount.toFixed(2)) > balance) {
        const codAmount = fromCents(balance < 0n ? 0n : balance);
        const codStatus: CodStatus = balance > 0n ? 'PENDING' : 'NOT_APPLICABLE';
        await tx.delivery.updateMany({
          where: tenantWhere(auth, { orderId }),
          data: { codAmount, codStatus },
        });
        codChange = { amount: codAmount, from: codDelivery.codStatus, to: codStatus };
      }
    }

    // The history: no reference or notes text (§8.2).
    await tx.orderEvent.create({
      data: tenantData(auth, {
        orderId,
        actorUserId: auth.userId,
        type:
          input.type === 'PAYMENT' ? ('PAYMENT_RECORDED' as const) : ('REFUND_RECORDED' as const),
        newValue: {
          paymentId: payment.id,
          amount: input.amount,
          method: input.method,
          occurredAt: payment.occurredAt.toISOString(),
          ...(codChange === null ? {} : { codAmount: codChange.amount }),
        },
      }),
    });
    if (codChange !== null && codChange.from !== codChange.to) {
      await tx.orderEvent.create({
        data: tenantData(auth, {
          orderId,
          actorUserId: auth.userId,
          type: 'COD_STATUS_CHANGED' as const,
          oldValue: { codStatus: codChange.from },
          newValue: { codStatus: codChange.to, codAmount: codChange.amount },
        }),
      });
    }

    return { payment: toView(payment), order: await loadOrderDetail(tx, auth, orderId) };
  }
}
