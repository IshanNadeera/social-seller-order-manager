import { Injectable } from '@nestjs/common';
import { checkOrderTransition, nextCodStatus } from '@ssom/shared';
import type { OrderDetail, OrderStatus } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { tenantData, tenantWhere } from '../common/tenant';
import { refuse } from './order-errors';
import { lockOrder } from './order-lock';
import { loadOrderDetail } from './order-view';

/**
 * Order status changes made by the seller (docs/DEVELOPMENT.md §7.2, §9.4): POST /orders/:id/status
 * and POST /orders/:id/cancel. Delivery-driven changes (dispatch, delivered, returned) are the
 * delivery actions' job.
 */
@Injectable()
export class OrderStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Moves the order to `to` if the transition validator allows it, in one transaction with its side
   * effects: completion and cancellation timestamps, COD → NOT_APPLICABLE on cancel, and the events.
   */
  changeStatus(
    auth: AuthContext,
    id: string,
    to: OrderStatus,
    reason: string | null,
  ): Promise<OrderDetail> {
    return this.prisma.$transaction(async (tx) => {
      // Locked, so two changes to the same order can't both start from the same status.
      await lockOrder(tx, auth, id);
      const order = await tx.order.findFirstOrThrow({
        where: tenantWhere(auth, { id }),
        select: {
          orderStatus: true,
          fulfilmentType: true,
          delivery: { select: { status: true, codStatus: true, codAmount: true } },
        },
      });
      const from = order.orderStatus;
      const check = checkOrderTransition(from, to, {
        fulfilmentType: order.fulfilmentType,
        deliveryStatus: order.delivery?.status ?? null,
        role: auth.role,
        reason,
      });
      if (!check.ok) {
        throw refuse(check.code, check.message, check.code === 'REASON_REQUIRED' ? 'reason' : 'to');
      }

      const now = new Date();
      await tx.order.updateMany({
        where: tenantWhere(auth, { id }),
        data: {
          orderStatus: to,
          ...(to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(to === 'CANCELLED' ? { cancelledAt: now, cancelReason: reason } : {}),
        },
      });
      await tx.orderEvent.create({
        data: tenantData(auth, {
          orderId: id,
          actorUserId: auth.userId,
          type: 'ORDER_STATUS_CHANGED' as const,
          oldValue: { orderStatus: from },
          newValue: { orderStatus: to },
          reason,
        }),
      });

      // §7.2: a cancelled or returned order collects no COD.
      const delivery = order.delivery;
      if ((to === 'CANCELLED' || to === 'RETURNED') && delivery !== null) {
        const codStatus = nextCodStatus(delivery.codStatus, 'ORDER_CANCELLED_OR_RETURNED');
        if (codStatus !== null) {
          await tx.delivery.updateMany({
            where: tenantWhere(auth, { orderId: id }),
            data: { codStatus },
          });
          await tx.orderEvent.create({
            data: tenantData(auth, {
              orderId: id,
              actorUserId: auth.userId,
              type: 'COD_STATUS_CHANGED' as const,
              oldValue: { codStatus: delivery.codStatus },
              newValue: { codStatus, codAmount: delivery.codAmount.toFixed(2) },
              reason,
            }),
          });
        }
      }

      return loadOrderDetail(tx, auth, id);
    });
  }
}
