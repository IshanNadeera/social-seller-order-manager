import { Injectable } from '@nestjs/common';
import { MAX_EXPORT_ROWS, ORDER_STAGE_LABELS, localDateOf, orderStage } from '@ssom/shared';
import type { OrderExportQuery } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { calculateBalance } from '../orders/order-calculator';
import { refuse } from '../orders/order-errors';
import { orderListWhere } from '../orders/order-search';
import { csvHeader, csvRow, localDateTime } from './csv';

/** Orders read per query while writing the file. */
const BATCH = 1000;
/** Reading up to MAX_EXPORT_ROWS orders takes longer than Prisma's default 5 s. */
const EXPORT_TIMEOUT_MS = 30_000;

/** The columns, in order. Money is plain decimal text ("1500.00") so spreadsheets can add it up. */
export const ORDER_CSV_COLUMNS = [
  'Order number',
  'Created',
  'Stage',
  'Order status',
  'Payment status',
  'Delivery status',
  'Source',
  'Source note',
  'Fulfilment',
  'Payment method',
  'Customer',
  'Customer phone',
  'Items',
  'Subtotal',
  'Discount',
  'Delivery fee',
  'Total',
  'Paid',
  'Refunded',
  'Balance due',
  'Refund owed',
  'Recipient',
  'Delivery phone',
  'Address',
  'City',
  'District',
  'Postal code',
  'Courier',
  'Tracking number',
  'COD amount',
  'COD status',
  'Notes',
] as const;

const money = (value: { toFixed(digits: number): string }) => value.toFixed(2);

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /exports/orders.csv (§9.4): the business's orders matching the orders list's search and
   * filters, newest first, as CSV. Scoped by the caller's membership like the list itself, and read
   * in one REPEATABLE READ transaction so the file is one consistent picture.
   */
  async ordersCsv(
    auth: AuthContext,
    query: OrderExportQuery,
    now: Date = new Date(),
  ): Promise<{ csv: string; filename: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        const { timezone: timeZone } = await tx.business.findUniqueOrThrow({
          where: { id: auth.businessId },
          select: { timezone: true },
        });
        const where = orderListWhere(auth, query, timeZone);
        const total = await tx.order.count({ where });
        if (total > MAX_EXPORT_ROWS) {
          throw refuse(
            'EXPORT_TOO_LARGE',
            `These filters match ${total} orders; one file holds at most ${MAX_EXPORT_ROWS}. Choose a shorter date range or more filters.`,
          );
        }

        let csv = csvHeader(ORDER_CSV_COLUMNS);
        for (let skip = 0; skip < total; skip += BATCH) {
          const orders = await tx.order.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip,
            take: BATCH,
            include: {
              items: {
                orderBy: { position: 'asc' },
                select: { productNameSnapshot: true, skuSnapshot: true, quantity: true },
              },
              delivery: true,
            },
          });
          for (const order of orders) {
            const { delivery } = order;
            const closed = order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED';
            const { balanceDue, refundOwed } = calculateBalance({
              totalAmount: money(order.totalAmount),
              amountPaid: money(order.amountPaid),
              amountRefunded: money(order.amountRefunded),
              closed,
            });
            csv += csvRow([
              order.orderNumber,
              localDateTime(order.createdAt, timeZone),
              ORDER_STAGE_LABELS[orderStage(order.orderStatus, delivery?.status ?? null)],
              order.orderStatus,
              order.paymentStatus,
              delivery?.status ?? null,
              order.sourceChannel,
              order.sourceNote,
              order.fulfilmentType,
              order.paymentMethod,
              order.customerNameSnapshot,
              order.customerPhoneSnapshot,
              order.items
                .map(
                  (item) =>
                    `${item.quantity} × ${item.productNameSnapshot}${item.skuSnapshot === null ? '' : ` (${item.skuSnapshot})`}`,
                )
                .join('; '),
              money(order.subtotal),
              money(order.discountAmount),
              money(order.deliveryFee),
              money(order.totalAmount),
              money(order.amountPaid),
              money(order.amountRefunded),
              balanceDue,
              refundOwed,
              delivery?.recipientName ?? null,
              delivery?.phone ?? null,
              delivery === null
                ? null
                : [delivery.addressLine1, delivery.addressLine2].filter(Boolean).join(', '),
              delivery?.city ?? null,
              delivery?.district ?? null,
              delivery?.postalCode ?? null,
              delivery?.courierName ?? null,
              delivery?.trackingNumber ?? null,
              delivery === null ? null : money(delivery.codAmount),
              delivery?.codStatus ?? null,
              order.notes,
            ]);
          }
        }
        return { csv, filename: `orders-${localDateOf(now, timeZone)}.csv` };
      },
      { isolationLevel: 'RepeatableRead', timeout: EXPORT_TIMEOUT_MS },
    );
  }
}
