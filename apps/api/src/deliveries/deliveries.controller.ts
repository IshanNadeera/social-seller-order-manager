import { Body, Controller, Header, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  deliveryDeliveredSchema,
  deliveryDispatchSchema,
  deliveryFailedSchema,
  deliveryReturnedSchema,
  deliveryUpdateSchema,
} from '@ssom/shared';
import type {
  DeliveryDispatchInput,
  DeliveryFailedInput,
  DeliveryReturnedInput,
  DeliveryUpdateInput,
  OrderDetail,
} from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { DeliveriesService } from './deliveries.service';

/**
 * /api/v1/orders/:id/delivery (docs/DEVELOPMENT.md §9.4). Status changes are named actions, not a
 * generic "set status", so each checks its own preconditions (§9.4, ADR-012).
 */
@Controller('orders/:id/delivery')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** Recipient and address (before dispatch), courier and tracking (until returned), COD amount, notes. */
  @Patch()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(deliveryUpdateSchema)) input: DeliveryUpdateInput,
  ): Promise<OrderDetail> {
    return this.deliveries.update(auth, id, input);
  }

  /** PENDING or FAILED → DISPATCHED: the order must be READY; the COD amount is now frozen. */
  @Post('dispatch')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  dispatch(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(deliveryDispatchSchema)) input: DeliveryDispatchInput,
  ): Promise<OrderDetail> {
    return this.deliveries.act(auth, id, { to: 'DISPATCHED', ...input });
  }

  /** DISPATCHED → DELIVERED: the order becomes COMPLETED; a pending COD is now with the courier. */
  @Post('delivered')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  delivered(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(deliveryDeliveredSchema)) _input: object,
  ): Promise<OrderDetail> {
    return this.deliveries.act(auth, id, { to: 'DELIVERED' });
  }

  /** DISPATCHED → FAILED, with a reason. It can then be dispatched again or returned. */
  @Post('failed')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  failed(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(deliveryFailedSchema)) input: DeliveryFailedInput,
  ): Promise<OrderDetail> {
    return this.deliveries.act(auth, id, { to: 'FAILED', reason: input.reason });
  }

  /**
   * FAILED → RETURNED, or DELIVERED → RETURNED (owner correction, reason required): the order becomes
   * RETURNED and COD still to come is cancelled.
   */
  @Post('returned')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  returned(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(deliveryReturnedSchema)) input: DeliveryReturnedInput,
  ): Promise<OrderDetail> {
    return this.deliveries.act(auth, id, { to: 'RETURNED', reason: input.reason ?? null });
  }
}
