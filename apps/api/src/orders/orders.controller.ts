import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  orderCreateSchema,
  orderEventsQuerySchema,
  orderListQuerySchema,
  orderUpdateSchema,
} from '@ssom/shared';
import type {
  OrderCreateInput,
  OrderDetail,
  OrderEventView,
  OrderEventsQuery,
  OrderListQuery,
  OrderSummary,
  OrderUpdateInput,
  Page,
} from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe, ZodQueryPipe } from '../common/zod-body.pipe';
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

  /** Filtered, paged list (§6.3, §9.5). */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<Page<OrderSummary>> {
    return this.orders.list(auth, query);
  }

  /** One order with items, delivery and payment summary (§9.4). */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.get(auth, id);
  }

  /** The order's activity history, oldest first (§9.4). */
  @Get(':id/events')
  @Header('Cache-Control', 'no-store')
  events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Query(new ZodQueryPipe(orderEventsQuerySchema)) query: OrderEventsQuery,
  ): Promise<Page<OrderEventView>> {
    return this.orders.events(auth, id, query);
  }

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

  /** Edits what §7.4 still allows; totals and the payment summary are recalculated (§9.4). */
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(orderUpdateSchema)) input: OrderUpdateInput,
  ): Promise<OrderDetail> {
    return this.orders.update(auth, id, input);
  }
}
