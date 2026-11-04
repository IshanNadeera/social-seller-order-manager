import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { paymentCreateSchema, paymentListQuerySchema } from '@ssom/shared';
import type {
  Page,
  PaymentCreateInput,
  PaymentListQuery,
  PaymentRecorded,
  PaymentView,
} from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe, ZodQueryPipe } from '../common/zod-body.pipe';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from './payments.service';

/**
 * /api/v1/orders/:id/payments (docs/DEVELOPMENT.md §9.4, §7.7). Insert-only: there is deliberately
 * no PATCH or DELETE (ADR-014); a mistake is corrected with a refund.
 */
@Controller('orders/:id/payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** The order's payments and refunds, oldest first. */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Query(new ZodQueryPipe(paymentListQuerySchema)) query: PaymentListQuery,
  ): Promise<Page<PaymentView>> {
    return this.payments.list(auth, id, query);
  }

  /** Records a payment or refund. Needs an Idempotency-Key, so a retry never records it twice (§9.8). */
  @Post()
  @Header('Cache-Control', 'no-store')
  async record(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @IdempotencyKey() key: string,
    @Body(new ZodBodyPipe(paymentCreateSchema)) input: PaymentCreateInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentRecorded> {
    const result = await this.idempotency.execute(
      auth,
      // The order is part of the request: the same key on another order is a different request.
      { key, endpoint: 'POST /orders/:id/payments', payload: { orderId: id, ...input } },
      (tx) => this.payments.record(tx, auth, id, input),
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}
