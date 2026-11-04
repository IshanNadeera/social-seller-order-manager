import { Body, Controller, Header, Param, Patch } from '@nestjs/common';
import { deliveryUpdateSchema } from '@ssom/shared';
import type { DeliveryUpdateInput, OrderDetail } from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { DeliveriesService } from './deliveries.service';

/** /api/v1/orders/:id/delivery (docs/DEVELOPMENT.md §9.4). Delivery actions come with D3. */
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
}
