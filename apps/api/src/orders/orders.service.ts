import { Injectable } from '@nestjs/common';
import {
  MAX_ACTIVE_ADDRESSES,
  WALK_IN_CUSTOMER_NAME,
  cents,
  checkOrderEdit,
  maskPhone,
  nextCodStatus,
  orderStage,
} from '@ssom/shared';
import type {
  CodStatus,
  EditGroup,
  OrderCreateInput,
  OrderDetail,
  OrderEventView,
  OrderEventsQuery,
  OrderListQuery,
  OrderSummary,
  OrderUpdateInput,
  Page,
} from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { orNotFound, tenantData, tenantWhere } from '../common/tenant';
import { lockActiveCustomer } from '../customers/customer-lock';
import type { Prisma } from '../generated/prisma/client';
import { recalculatePaymentSummary } from '../payments/payment-summary';
import { OrderCalculationError, calculateBalance, calculateOrderTotals } from './order-calculator';
import { refuse } from './order-errors';
import { lockOrder } from './order-lock';
import { allocateOrderNumber } from './order-number';
import { ORDER_LIST_ORDER, orderListWhere } from './order-search';
import { loadOrderDetail } from './order-view';

type Tx = Prisma.TransactionClient;

/** §7.5 totals; a broken rule becomes a 422 on its field. */
function totalsOrRefuse(input: Parameters<typeof calculateOrderTotals>[0]) {
  try {
    return calculateOrderTotals(input);
  } catch (error) {
    if (error instanceof OrderCalculationError)
      throw refuse(error.code, error.message, error.field);
    throw error;
  }
}

/** The request field each edit-lock group answers on (§9.7 fieldErrors). */
const GROUP_FIELD: Record<EditGroup, string> = {
  items: 'items',
  deliveryAddress: 'delivery',
  courier: 'delivery',
  notes: 'notes',
  sourceChannel: 'sourceChannel',
  fulfilmentType: 'fulfilmentType',
};

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

/**
 * Orders (docs/DEVELOPMENT.md §7, §9.4, §9.6). Every method takes the caller's scope; business IDs,
 * totals and statuses never come from the client.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /orders (§6.3, §9.5): filtered, searched, newest first, at most 100 per page. */
  async list(auth: AuthContext, query: OrderListQuery): Promise<Page<OrderSummary>> {
    const { timezone } = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { timezone: true },
    });
    const where = orderListWhere(auth, query, timezone);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: ORDER_LIST_ORDER,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          customerNameSnapshot: true,
          customerPhoneSnapshot: true,
          totalAmount: true,
          amountPaid: true,
          amountRefunded: true,
          orderStatus: true,
          paymentStatus: true,
          sourceChannel: true,
          fulfilmentType: true,
          delivery: { select: { status: true } },
        },
      }),
    ]);
    const items = rows.map((row): OrderSummary => {
      const deliveryStatus = row.delivery?.status ?? null;
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        createdAt: row.createdAt.toISOString(),
        customerName: row.customerNameSnapshot,
        customerPhoneMasked: maskPhone(row.customerPhoneSnapshot),
        totalAmount: row.totalAmount.toFixed(2),
        balanceDue: calculateBalance({
          totalAmount: row.totalAmount.toFixed(2),
          amountPaid: row.amountPaid.toFixed(2),
          amountRefunded: row.amountRefunded.toFixed(2),
          closed: row.orderStatus === 'CANCELLED' || row.orderStatus === 'RETURNED',
        }).balanceDue,
        stage: orderStage(row.orderStatus, deliveryStatus),
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        deliveryStatus,
        sourceChannel: row.sourceChannel,
        fulfilmentType: row.fulfilmentType,
      };
    });
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  /** GET /orders/:id (§9.4): the order with items, delivery and payment summary; 404 otherwise. */
  get(auth: AuthContext, id: string): Promise<OrderDetail> {
    return loadOrderDetail(this.prisma, auth, id);
  }

  /** GET /orders/:id/events (§9.4): the activity history, oldest first, with who did what. */
  async events(
    auth: AuthContext,
    id: string,
    query: OrderEventsQuery,
  ): Promise<Page<OrderEventView>> {
    orNotFound(
      await this.prisma.order.findFirst({ where: tenantWhere(auth, { id }), select: { id: true } }),
    );
    const where = tenantWhere(auth, { orderId: id });
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.orderEvent.count({ where }),
      this.prisma.orderEvent.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    // Only members of this business act on its orders; their names come from users.
    const actorIds = [
      ...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : []))),
    ];
    const actors = await this.prisma.user.findMany({
      where: {
        id: { in: actorIds },
        memberships: { some: { businessId: auth.businessId } },
      },
      select: { id: true, fullName: true, email: true },
    });
    const nameOf = new Map(actors.map((user) => [user.id, user.fullName ?? user.email]));
    const items = rows.map((row): OrderEventView => ({
      id: row.id,
      type: row.type,
      actor:
        row.actorUserId === null
          ? null
          : { id: row.actorUserId, name: nameOf.get(row.actorUserId) ?? '' },
      oldValue: row.oldValue,
      newValue: row.newValue,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Creates an order: §9.6 steps 1–6, all in `tx` (the controller's idempotent transaction, which is
   * step 7). Any failure rolls back everything, the order number included.
   */
  async create(tx: Tx, auth: AuthContext, input: OrderCreateInput): Promise<OrderDetail> {
    // 1. The customer, products and saved address must belong to this business.
    const customer = await this.loadCustomer(tx, auth, input.customerId ?? null);
    const lines = await this.resolveLines(tx, auth, input.items);
    if (input.delivery?.sourceAddressId) {
      await this.checkSourceAddress(tx, auth, input.delivery.sourceAddressId, customer?.id ?? null);
    }

    // 2–3. Totals are calculated here; the client never sends them (the schema refuses them).
    const business = await tx.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { currency: true, defaultDeliveryFee: true },
    });
    const isDelivery = input.fulfilmentType === 'DELIVERY';
    const deliveryFee =
      input.deliveryFee ?? (isDelivery ? business.defaultDeliveryFee.toFixed(2) : '0.00');
    const totals = totalsOrRefuse({
      items: lines,
      discountAmount: input.discountAmount,
      deliveryFee,
    });

    // The advance may not exceed the total (§7.7); COD defaults to what is left (§7.8).
    const advance = input.initialPayment?.amount ?? '0.00';
    const balanceAfterAdvance = cents(totals.totalAmount) - cents(advance);
    if (balanceAfterAdvance < 0n) {
      throw refuse(
        'PAYMENT_EXCEEDS_BALANCE',
        'The amount received can’t be more than the order total.',
        'initialPayment.amount',
      );
    }
    const codAmount =
      input.paymentMethod === 'COD'
        ? (input.delivery?.codAmount ?? fromCents(balanceAfterAdvance))
        : '0.00';
    if (cents(codAmount) > balanceAfterAdvance) {
      throw refuse(
        'COD_EXCEEDS_BALANCE',
        'The COD amount can’t be more than the balance due.',
        'delivery.codAmount',
      );
    }
    const codStatus =
      cents(codAmount) > 0n
        ? (nextCodStatus('NOT_APPLICABLE', 'ORDER_SAVED_AS_COD') ?? 'NOT_APPLICABLE')
        : 'NOT_APPLICABLE';

    // 4. The order number, from the locked counter row.
    const { orderNumber } = await allocateOrderNumber(tx, auth);

    // 5. The order, its items, its delivery copy and the advance payment.
    const order = await tx.order.create({
      data: tenantData(auth, {
        orderNumber,
        customerId: customer?.id ?? null,
        sourceChannel: input.sourceChannel,
        sourceNote: input.sourceNote ?? null,
        fulfilmentType: input.fulfilmentType,
        paymentMethod: input.paymentMethod,
        currency: business.currency,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        deliveryFee: totals.deliveryFee,
        totalAmount: totals.totalAmount,
        customerNameSnapshot: customer?.name ?? WALK_IN_CUSTOMER_NAME,
        customerPhoneSnapshot: customer?.phoneDisplay ?? null,
        notes: input.notes ?? null,
        createdById: auth.userId,
      }),
      select: { id: true },
    });
    await tx.orderItem.createMany({
      data: lines.map((line, index) =>
        tenantData(auth, {
          orderId: order.id,
          productId: line.productId,
          position: index + 1,
          productNameSnapshot: line.name,
          skuSnapshot: line.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: totals.lineTotals[index] ?? '0.00',
        }),
      ),
    });
    const delivery = input.delivery;
    if (delivery !== undefined) {
      await tx.delivery.create({
        data: tenantData(auth, {
          orderId: order.id,
          recipientName: delivery.recipientName,
          phone: delivery.phone,
          addressLine1: delivery.addressLine1,
          addressLine2: delivery.addressLine2 ?? null,
          city: delivery.city ?? null,
          district: delivery.district ?? null,
          postalCode: delivery.postalCode ?? null,
          sourceAddressId: delivery.sourceAddressId ?? null,
          codAmount,
          codStatus,
        }),
      });
      if (delivery.saveToCustomer === true && customer !== null) {
        await this.saveAddressToCustomer(tx, auth, customer.id, delivery);
      }
    }
    if (cents(advance) > 0n) {
      const method = input.initialPayment?.method ?? input.paymentMethod;
      await tx.payment.create({
        data: tenantData(auth, {
          orderId: order.id,
          type: 'PAYMENT' as const,
          method,
          amount: advance,
          recordedById: auth.userId,
          occurredAt: new Date(),
        }),
      });
    }
    await recalculatePaymentSummary(tx, auth, order.id);

    // 6. The activity history. No phone numbers or addresses in events (§8.2).
    await tx.orderEvent.create({
      data: tenantData(auth, {
        orderId: order.id,
        actorUserId: auth.userId,
        type: 'ORDER_CREATED' as const,
        newValue: {
          orderNumber,
          sourceChannel: input.sourceChannel,
          fulfilmentType: input.fulfilmentType,
          paymentMethod: input.paymentMethod,
          itemCount: lines.length,
          totalAmount: totals.totalAmount,
        },
      }),
    });
    if (cents(advance) > 0n) {
      await tx.orderEvent.create({
        data: tenantData(auth, {
          orderId: order.id,
          actorUserId: auth.userId,
          type: 'PAYMENT_RECORDED' as const,
          newValue: {
            amount: advance,
            method: input.initialPayment?.method ?? input.paymentMethod,
          },
        }),
      });
    }

    return loadOrderDetail(tx, auth, order.id);
  }

  /**
   * PATCH /orders/:id (§7.4), in one transaction: locks the order, checks the edit-lock rules for the
   * field groups that really change, saves items, totals, fulfilment and COD, recalculates the payment
   * summary and logs ORDER_UPDATED. An edit that changes nothing returns the order with no event.
   */
  update(auth: AuthContext, id: string, input: OrderUpdateInput): Promise<OrderDetail> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, auth, id);
      const order = await tx.order.findFirstOrThrow({
        where: tenantWhere(auth, { id }),
        select: {
          orderStatus: true,
          fulfilmentType: true,
          paymentMethod: true,
          sourceChannel: true,
          sourceNote: true,
          notes: true,
          customerId: true,
          discountAmount: true,
          deliveryFee: true,
          subtotal: true,
          totalAmount: true,
          amountPaid: true,
          amountRefunded: true,
          items: {
            orderBy: { position: 'asc' },
            select: { productNameSnapshot: true, quantity: true, unitPrice: true },
          },
          delivery: { select: { status: true, codAmount: true, codStatus: true } },
        },
      });
      const money = (value: { toFixed(digits: number): string }) => value.toFixed(2);

      // The order as it would be after the edit.
      const fulfilmentType = input.fulfilmentType ?? order.fulfilmentType;
      const paymentMethod = input.paymentMethod ?? order.paymentMethod;
      const sourceChannel = input.sourceChannel ?? order.sourceChannel;
      const sourceNote = input.sourceNote === undefined ? order.sourceNote : input.sourceNote;
      const notes = input.notes === undefined ? order.notes : input.notes;
      const isDelivery = fulfilmentType === 'DELIVERY';
      const switching = fulfilmentType !== order.fulfilmentType;

      if (!isDelivery && paymentMethod === 'COD') {
        throw refuse(
          'COD_NEEDS_DELIVERY',
          'Cash on delivery is only for delivery orders. Choose another payment method.',
          'paymentMethod',
        );
      }
      if (sourceChannel === 'OTHER' && sourceNote === null) {
        throw refuse('SOURCE_NOTE_REQUIRED', 'Say where this order came from.', 'sourceNote');
      }
      if (input.delivery !== undefined && !(switching && isDelivery)) {
        throw refuse(
          'DELIVERY_EXISTS',
          'This order already has a delivery address. Change it in the delivery details.',
          'delivery',
        );
      }
      if (switching && isDelivery) {
        if (order.customerId === null) {
          throw refuse(
            'CUSTOMER_REQUIRED',
            'An order without a customer must be a pickup.',
            'fulfilmentType',
          );
        }
        if (input.delivery === undefined) {
          throw refuse('DELIVERY_ADDRESS_REQUIRED', 'Enter the delivery address.', 'delivery');
        }
        if (input.delivery.sourceAddressId) {
          await this.checkSourceAddress(tx, auth, input.delivery.sourceAddressId, order.customerId);
        }
      }

      // Money: a pickup order has no delivery fee; a new delivery takes the business default.
      let deliveryFee = input.deliveryFee ?? money(order.deliveryFee);
      if (!isDelivery) {
        if (input.deliveryFee !== undefined && input.deliveryFee !== '0.00') {
          throw refuse('PICKUP_HAS_NO_FEE', 'A pickup order has no delivery fee.', 'deliveryFee');
        }
        deliveryFee = '0.00';
      } else if (switching && input.deliveryFee === undefined) {
        const business = await tx.business.findUniqueOrThrow({
          where: { id: auth.businessId },
          select: { defaultDeliveryFee: true },
        });
        deliveryFee = money(business.defaultDeliveryFee);
      }
      const lines =
        input.items === undefined ? null : await this.resolveLines(tx, auth, input.items);
      const totals = totalsOrRefuse({
        items:
          lines ??
          order.items.map((item) => ({
            quantity: item.quantity,
            unitPrice: money(item.unitPrice),
          })),
        discountAmount: input.discountAmount ?? money(order.discountAmount),
        deliveryFee,
      });
      const moneyChanged =
        lines !== null ||
        totals.discountAmount !== money(order.discountAmount) ||
        totals.deliveryFee !== money(order.deliveryFee);

      // §7.4: only the groups that really change are checked, so resending a value is harmless.
      const groups: EditGroup[] = [];
      if (moneyChanged) groups.push('items');
      if (switching || paymentMethod !== order.paymentMethod) groups.push('fulfilmentType');
      if (sourceChannel !== order.sourceChannel || sourceNote !== order.sourceNote) {
        groups.push('sourceChannel');
      }
      if (notes !== order.notes) groups.push('notes');
      if (groups.length === 0) return loadOrderDetail(tx, auth, id);

      const netPaid = cents(money(order.amountPaid)) - cents(money(order.amountRefunded));
      const check = checkOrderEdit(
        {
          orderStatus: order.orderStatus,
          fulfilmentType: order.fulfilmentType,
          deliveryStatus: order.delivery?.status ?? null,
        },
        groups,
        moneyChanged ? { newTotal: totals.totalAmount, netPaid: fromCents(netPaid) } : undefined,
      );
      if (!check.ok) throw refuse(check.code, check.message, GROUP_FIELD[check.group]);

      // Save. Items are replaced as a whole; their totals come from the calculator.
      if (lines !== null) {
        await tx.orderItem.deleteMany({ where: tenantWhere(auth, { orderId: id }) });
        await tx.orderItem.createMany({
          data: lines.map((line, index) =>
            tenantData(auth, {
              orderId: id,
              productId: line.productId,
              position: index + 1,
              productNameSnapshot: line.name,
              skuSnapshot: line.sku,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: totals.lineTotals[index] ?? '0.00',
            }),
          ),
        });
      }
      await tx.order.updateMany({
        where: tenantWhere(auth, { id }),
        data: {
          sourceChannel,
          sourceNote,
          fulfilmentType,
          paymentMethod,
          notes,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          deliveryFee: totals.deliveryFee,
          totalAmount: totals.totalAmount,
        },
      });

      // Delivery row and COD. Before dispatch, COD follows the balance due (§7.8).
      const codChanged = moneyChanged || switching || paymentMethod !== order.paymentMethod;
      const balance = cents(totals.totalAmount) - netPaid;
      const codAmount =
        isDelivery && paymentMethod === 'COD' && balance > 0n ? fromCents(balance) : '0.00';
      const codStatus: CodStatus = cents(codAmount) > 0n ? 'PENDING' : 'NOT_APPLICABLE';
      const oldCodStatus = order.delivery?.codStatus ?? 'NOT_APPLICABLE';
      if (switching && !isDelivery) {
        // Still PENDING: checkOrderEdit refuses a switch after dispatch.
        await tx.delivery.deleteMany({ where: tenantWhere(auth, { orderId: id }) });
      } else if (switching && input.delivery !== undefined) {
        const address = input.delivery;
        await tx.delivery.create({
          data: tenantData(auth, {
            orderId: id,
            recipientName: address.recipientName,
            phone: address.phone,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? null,
            city: address.city ?? null,
            district: address.district ?? null,
            postalCode: address.postalCode ?? null,
            sourceAddressId: address.sourceAddressId ?? null,
            codAmount,
            codStatus,
          }),
        });
      } else if (isDelivery && codChanged) {
        await tx.delivery.updateMany({
          where: tenantWhere(auth, { orderId: id }),
          data: { codAmount, codStatus },
        });
      }
      await recalculatePaymentSummary(tx, auth, id);

      // The history: what changed, without phone numbers, addresses or free text (§8.2).
      const oldValue: Record<string, Prisma.InputJsonValue> = {};
      const newValue: Record<string, Prisma.InputJsonValue> = {};
      const record = (key: string, before: string, after: string) => {
        if (before === after) return;
        oldValue[key] = before;
        newValue[key] = after;
      };
      record('sourceChannel', order.sourceChannel, sourceChannel);
      record('fulfilmentType', order.fulfilmentType, fulfilmentType);
      record('paymentMethod', order.paymentMethod, paymentMethod);
      record('subtotal', money(order.subtotal), totals.subtotal);
      record('discountAmount', money(order.discountAmount), totals.discountAmount);
      record('deliveryFee', money(order.deliveryFee), totals.deliveryFee);
      record('totalAmount', money(order.totalAmount), totals.totalAmount);
      if (lines !== null) {
        oldValue.items = order.items.map((item) => ({
          name: item.productNameSnapshot,
          quantity: item.quantity,
          unitPrice: money(item.unitPrice),
        }));
        newValue.items = lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }));
      }
      if (switching) newValue.delivery = isDelivery ? 'CREATED' : 'REMOVED';
      if (sourceNote !== order.sourceNote) newValue.sourceNoteChanged = true;
      if (notes !== order.notes) newValue.notesChanged = true;
      await tx.orderEvent.create({
        data: tenantData(auth, {
          orderId: id,
          actorUserId: auth.userId,
          type: 'ORDER_UPDATED' as const,
          oldValue,
          newValue,
        }),
      });
      if (isDelivery && codChanged && codStatus !== oldCodStatus) {
        await tx.orderEvent.create({
          data: tenantData(auth, {
            orderId: id,
            actorUserId: auth.userId,
            type: 'COD_STATUS_CHANGED' as const,
            oldValue: { codStatus: oldCodStatus },
            newValue: { codStatus, codAmount },
          }),
        });
      }

      return loadOrderDetail(tx, auth, id);
    });
  }

  /** An active customer of this business, locked for the transaction; 404 / 422 otherwise. */
  private async loadCustomer(tx: Tx, auth: AuthContext, customerId: string | null) {
    if (customerId === null) return null;
    await lockActiveCustomer(tx, auth, customerId);
    return tx.customer.findFirstOrThrow({
      where: tenantWhere(auth, { id: customerId }),
      select: { id: true, name: true, phoneDisplay: true },
    });
  }

  /** Each line's name, SKU and price: from the product (price may be overridden), or as typed. */
  private async resolveLines(tx: Tx, auth: AuthContext, items: OrderCreateInput['items']) {
    const ids = [...new Set(items.flatMap((item) => (item.productId ? [item.productId] : [])))];
    const products = await tx.product.findMany({
      where: tenantWhere(auth, { id: { in: ids } }),
      select: { id: true, name: true, sku: true, sellingPrice: true, archivedAt: true },
    });
    return items.map((item, index) => {
      if (item.productId === undefined) {
        return {
          productId: null,
          name: item.name ?? '',
          sku: null,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? '0.00',
        };
      }
      const product = products.find((candidate) => candidate.id === item.productId);
      // Another business's product looks exactly like a missing one.
      if (product === undefined || product.archivedAt !== null) {
        throw refuse(
          'PRODUCT_NOT_AVAILABLE',
          'This product isn’t available. It may have been archived or removed.',
          `items[${index}].productId`,
        );
      }
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? product.sellingPrice.toFixed(2),
      };
    });
  }

  private async checkSourceAddress(
    tx: Tx,
    auth: AuthContext,
    addressId: string,
    customerId: string | null,
  ): Promise<void> {
    const address =
      customerId === null
        ? null
        : await tx.customerAddress.findFirst({
            where: tenantWhere(auth, { id: addressId, customerId }),
            select: { id: true },
          });
    if (address === null) {
      throw refuse(
        'ADDRESS_NOT_AVAILABLE',
        'That saved address isn’t one of this customer’s.',
        'delivery.sourceAddressId',
      );
    }
  }

  /** "Save address to customer" (§6.4). The customer row is already locked by loadCustomer. */
  private async saveAddressToCustomer(
    tx: Tx,
    auth: AuthContext,
    customerId: string,
    address: NonNullable<OrderCreateInput['delivery']>,
  ): Promise<void> {
    const active = await tx.customerAddress.findMany({
      where: tenantWhere(auth, { customerId, archivedAt: null }),
      select: { isDefault: true },
    });
    if (active.length >= MAX_ACTIVE_ADDRESSES) {
      throw refuse(
        'ADDRESS_LIMIT_REACHED',
        `This customer already has ${MAX_ACTIVE_ADDRESSES} saved addresses. Untick "Save address to customer", or archive one first.`,
        'delivery.saveToCustomer',
      );
    }
    await tx.customerAddress.create({
      data: tenantData(auth, {
        customerId,
        label: null,
        recipientName: address.recipientName,
        phone: address.phone,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 ?? null,
        city: address.city ?? null,
        district: address.district ?? null,
        postalCode: address.postalCode ?? null,
        isDefault: !active.some((row) => row.isDefault),
      }),
    });
  }
}
