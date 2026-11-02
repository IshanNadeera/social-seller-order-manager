// The order as the API returns it (OrderDetail, §9.4). Used by POST /orders and later GET /orders/:id.
import { orderStage } from '@ssom/shared';
import type { OrderDetail } from '@ssom/shared';
import { orNotFound, tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { calculateBalance } from './order-calculator';

const orderSelect = {
  id: true,
  orderNumber: true,
  orderStatus: true,
  paymentStatus: true,
  sourceChannel: true,
  sourceNote: true,
  fulfilmentType: true,
  paymentMethod: true,
  customerId: true,
  customerNameSnapshot: true,
  customerPhoneSnapshot: true,
  subtotal: true,
  discountAmount: true,
  deliveryFee: true,
  totalAmount: true,
  amountPaid: true,
  amountRefunded: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      productId: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
  },
  delivery: {
    select: {
      status: true,
      recipientName: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      district: true,
      postalCode: true,
      courierName: true,
      trackingNumber: true,
      codAmount: true,
      codStatus: true,
    },
  },
} satisfies Prisma.OrderSelect;

/** Loads one order of the caller's business as OrderDetail, or the standard 404. */
export async function loadOrderDetail(
  db: Prisma.TransactionClient,
  scope: TenantScope,
  id: string,
): Promise<OrderDetail> {
  const order = orNotFound(
    await db.order.findFirst({ where: tenantWhere(scope, { id }), select: orderSelect }),
  );
  const money = (value: Prisma.Decimal) => value.toFixed(2);
  const closed = order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED';
  const { balanceDue, refundOwed } = calculateBalance({
    totalAmount: money(order.totalAmount),
    amountPaid: money(order.amountPaid),
    amountRefunded: money(order.amountRefunded),
    closed,
  });
  const { delivery } = order;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    stage: orderStage(order.orderStatus, delivery?.status ?? null),
    sourceChannel: order.sourceChannel,
    sourceNote: order.sourceNote,
    fulfilmentType: order.fulfilmentType,
    paymentMethod: order.paymentMethod,
    customer: {
      id: order.customerId,
      name: order.customerNameSnapshot,
      phone: order.customerPhoneSnapshot,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.productNameSnapshot,
      sku: item.skuSnapshot,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
    })),
    subtotal: money(order.subtotal),
    discountAmount: money(order.discountAmount),
    deliveryFee: money(order.deliveryFee),
    totalAmount: money(order.totalAmount),
    amountPaid: money(order.amountPaid),
    amountRefunded: money(order.amountRefunded),
    balanceDue,
    refundOwed,
    delivery: delivery === null ? null : { ...delivery, codAmount: money(delivery.codAmount) },
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
