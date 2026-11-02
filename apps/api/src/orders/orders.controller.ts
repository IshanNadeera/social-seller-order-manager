import { Body, Controller, Header, Post, Res } from '@nestjs/common';
import { orderCreateSchema } from '@ssom/shared';
import type { OrderCreateInput, OrderDetail } from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OrdersService } from './orders.service';

/** /api/v1/orders (docs/DEVELOPMENT.md §9.4). Responses hold personal data: not stored by browsers. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Creates an order in one transaction (§9.6). Needs an Idempotency-Key (§9.8). */
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() key: string,
    @Body(new ZodBodyPipe(orderCreateSchema)) input: OrderCreateInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDetail> {
    const result = await this.idempotency.execute(
      auth,
      { key, endpoint: 'POST /orders', payload: input },
      (tx) => this.orders.create(tx, auth, input),
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}
