import { Injectable } from '@nestjs/common';
import { DELIVERY_ADDRESS_FIELDS, cents, checkOrderEdit } from '@ssom/shared';
import type { CodStatus, DeliveryUpdateInput, EditGroup, OrderDetail } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { tenantData, tenantWhere } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { refuse } from '../orders/order-errors';
import { lockOrder } from '../orders/order-lock';
import { loadOrderDetail } from '../orders/order-view';

/** Non-negative cents back to "1234.50". */
const fromCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

/** The request field each edit-lock group answers on (§9.7 fieldErrors). */
const GROUP_FIELD: Partial<Record<EditGroup, string>> = {
  deliveryAddress: 'addressLine1',
  courier: 'courierName',
};

/**
 * The order's delivery (docs/DEVELOPMENT.md §7.4, §7.8, §9.4). Status changes (dispatch, delivered,
 * failed, returned) are separate actions (D3); this is the delivery's details.
 */
@Injectable()
export class DeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PATCH /orders/:id/delivery, in one transaction under the order lock. Only fields whose value
   * really changes are checked against §7.4, so resending a value is harmless. An edit that changes
   * nothing returns the order with no event.
   */
  update(auth: AuthContext, orderId: string, input: DeliveryUpdateInput): Promise<OrderDetail> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, auth, orderId);
      const order = await tx.order.findFirstOrThrow({
        where: tenantWhere(auth, { id: orderId }),
        select: {
          orderStatus: true,
          fulfilmentType: true,
          paymentMethod: true,
          totalAmount: true,
          amountPaid: true,
          amountRefunded: true,
          delivery: true,
        },
      });
      const { delivery } = order;
      if (delivery === null) {
        throw refuse(
          'NOT_A_DELIVERY_ORDER',
          'This is a pickup order, so it has no delivery details.',
        );
      }

      // What really changes. Optional text arrives as null when cleared.
      const data: Prisma.DeliveryUncheckedUpdateManyInput = {};
      const changed = new Set<string>();
      const set = <Key extends keyof DeliveryUpdateInput & keyof typeof delivery>(key: Key) => {
        const value = input[key];
        if (value === undefined || value === delivery[key]) return;
        changed.add(key);
        (data as Record<string, unknown>)[key] = value;
      };
      for (const field of DELIVERY_ADDRESS_FIELDS) set(field);
      set('courierName');
      set('trackingNumber');
      set('notes');
      const oldCod = delivery.codAmount.toFixed(2);
      const codChanged = input.codAmount !== undefined && input.codAmount !== oldCod;

      const groups: EditGroup[] = [];
      if (DELIVERY_ADDRESS_FIELDS.some((field) => changed.has(field)) || codChanged) {
        groups.push('deliveryAddress');
      }
      if (changed.has('courierName') || changed.has('trackingNumber')) groups.push('courier');
      if (changed.has('notes')) groups.push('notes');
      if (groups.length === 0) return loadOrderDetail(tx, auth, orderId);

      const check = checkOrderEdit(
        {
          orderStatus: order.orderStatus,
          fulfilmentType: order.fulfilmentType,
          deliveryStatus: delivery.status,
        },
        groups,
      );
      if (!check.ok) {
        const addressChanged = DELIVERY_ADDRESS_FIELDS.some((field) => changed.has(field));
        const field =
          check.group === 'deliveryAddress' && !addressChanged
            ? 'codAmount'
            : (GROUP_FIELD[check.group] ?? check.group);
        throw refuse(check.code, check.message, field);
      }

      // An edited address is no longer the customer's saved one (§7.11).
      if (DELIVERY_ADDRESS_FIELDS.some((field) => changed.has(field))) data.sourceAddressId = null;

      // §7.8: 0 ≤ COD amount ≤ balance due, editable until dispatch (checked above), COD orders only.
      let codStatus: CodStatus = delivery.codStatus;
      if (codChanged && input.codAmount !== undefined) {
        if (order.paymentMethod !== 'COD') {
          throw refuse(
            'NOT_A_COD_ORDER',
            'This order isn’t paid by cash on delivery, so it has no COD amount.',
            'codAmount',
          );
        }
        const netPaid = cents(order.amountPaid.toFixed(2)) - cents(order.amountRefunded.toFixed(2));
        const balance = cents(order.totalAmount.toFixed(2)) - netPaid;
        if (cents(input.codAmount) > balance) {
          throw refuse(
            'COD_EXCEEDS_BALANCE',
            `The COD amount can’t be more than the balance due (${fromCents(balance < 0n ? 0n : balance)}).`,
            'codAmount',
          );
        }
        codStatus = cents(input.codAmount) > 0n ? 'PENDING' : 'NOT_APPLICABLE';
        data.codAmount = input.codAmount;
        data.codStatus = codStatus;
      }

      await tx.delivery.updateMany({ where: tenantWhere(auth, { orderId }), data });

      // The history: which fields changed, and courier and COD values; no address or note text (§8.2).
      const oldValue: Record<string, Prisma.InputJsonValue | null> = {};
      const newValue: Record<string, Prisma.InputJsonValue | null> = {};
      const addressFields = DELIVERY_ADDRESS_FIELDS.filter((field) => changed.has(field));
      if (addressFields.length > 0) newValue.deliveryAddressChanged = [...addressFields];
      for (const key of ['courierName', 'trackingNumber'] as const) {
        if (!changed.has(key)) continue;
        oldValue[key] = delivery[key];
        newValue[key] = input[key] ?? null;
      }
      if (changed.has('notes')) newValue.deliveryNotesChanged = true;
      if (codChanged) {
        oldValue.codAmount = oldCod;
        newValue.codAmount = input.codAmount ?? null;
      }
      await tx.orderEvent.create({
        data: tenantData(auth, {
          orderId,
          actorUserId: auth.userId,
          type: 'ORDER_UPDATED' as const,
          oldValue,
          newValue,
        }),
      });
      if (codStatus !== delivery.codStatus) {
        await tx.orderEvent.create({
          data: tenantData(auth, {
            orderId,
            actorUserId: auth.userId,
            type: 'COD_STATUS_CHANGED' as const,
            oldValue: { codStatus: delivery.codStatus },
            newValue: { codStatus, codAmount: input.codAmount ?? oldCod },
          }),
        });
      }

      return loadOrderDetail(tx, auth, orderId);
    });
  }
}
