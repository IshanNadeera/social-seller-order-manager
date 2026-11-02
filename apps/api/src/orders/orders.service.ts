import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MAX_ACTIVE_ADDRESSES, WALK_IN_CUSTOMER_NAME, cents, nextCodStatus } from '@ssom/shared';
import type { OrderCreateInput, OrderDetail } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { tenantData, tenantWhere } from '../common/tenant';
import { lockActiveCustomer } from '../customers/customer-lock';
import type { Prisma } from '../generated/prisma/client';
import { recalculatePaymentSummary } from '../payments/payment-summary';
import { OrderCalculationError, calculateOrderTotals } from './order-calculator';
import { allocateOrderNumber } from './order-number';
import { loadOrderDetail } from './order-view';

type Tx = Prisma.TransactionClient;

/** 422 with the message on one field (§9.7 fieldErrors), or on none. */
function refuse(code: string, message: string, field?: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    message,
    fieldErrors: field === undefined ? {} : { [field]: message },
  });
}

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

/**
 * Orders (docs/DEVELOPMENT.md §7, §9.4, §9.6). Every method takes the caller's scope; business IDs,
 * totals and statuses never come from the client.
 */
@Injectable()
export class OrdersService {
  /**
   * Creates an order: §9.6 steps 1–6, all in `tx` (the controller's idempotent transaction, which is
   * step 7). Any failure rolls back everything, the order number included.
   */
  async create(tx: Tx, auth: AuthContext, input: OrderCreateInput): Promise<OrderDetail> {
    // 1. The customer, products and saved address must belong to this business.
    const customer = await this.loadCustomer(tx, auth, input.customerId ?? null);
    const lines = await this.resolveLines(tx, auth, input);
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
    let totals: ReturnType<typeof calculateOrderTotals>;
    try {
      totals = calculateOrderTotals({
        items: lines,
        discountAmount: input.discountAmount,
        deliveryFee,
      });
    } catch (error) {
      if (error instanceof OrderCalculationError)
        throw refuse(error.code, error.message, error.field);
      throw error;
    }

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
  private async resolveLines(tx: Tx, auth: AuthContext, input: OrderCreateInput) {
    const ids = [
      ...new Set(input.items.flatMap((item) => (item.productId ? [item.productId] : []))),
    ];
    const products = await tx.product.findMany({
      where: tenantWhere(auth, { id: { in: ids } }),
      select: { id: true, name: true, sku: true, sellingPrice: true, archivedAt: true },
    });
    return input.items.map((item, index) => {
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
