import { Body, Controller, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import { codSettleSchema } from '@ssom/shared';
import type { CodSettleInput, PaymentRecorded } from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from './payments.service';

/** /api/v1/orders/:id/cod (docs/DEVELOPMENT.md §9.4, §7.8). */
@Controller('orders/:id/cod')
export class CodController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * "COD settled": COLLECTED → SETTLED, creating one COD payment. Needs an Idempotency-Key, so a
   * retried request never records the money twice (§9.8, ADR-007).
   */
  @Post('settle')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async settle(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @IdempotencyKey() key: string,
    @Body(new ZodBodyPipe(codSettleSchema)) input: CodSettleInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentRecorded> {
    const result = await this.idempotency.execute(
      auth,
      { key, endpoint: 'POST /orders/:id/cod/settle', payload: { orderId: id, ...input } },
      (tx) => this.payments.settleCod(tx, auth, id, input),
      200,
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}
