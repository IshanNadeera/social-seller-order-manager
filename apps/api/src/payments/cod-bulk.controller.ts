import { Body, Controller, Get, Header, HttpCode, Post, Query, Res } from '@nestjs/common';
import { codAwaitingQuerySchema, codBulkSettleSchema } from '@ssom/shared';
import type {
  CodAwaitingItem,
  CodAwaitingQuery,
  CodBulkSettled,
  CodBulkSettleInput,
  Page,
} from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodBodyPipe, ZodQueryPipe } from '../common/zod-body.pipe';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from './payments.service';

/** Up to 50 orders in one transaction: more than Prisma's default 5 s on a slow connection. */
const BULK_SETTLE_TIMEOUT_MS = 30_000;

/** /api/v1/cod: COD across orders, for one courier remittance (docs/DEVELOPMENT.md §9.4, §2.2). */
@Controller('cod')
export class CodBulkController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Delivered COD orders whose money the courier still holds. */
  @Get('awaiting')
  @Header('Cache-Control', 'no-store')
  awaiting(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(codAwaitingQuerySchema)) query: CodAwaitingQuery,
  ): Promise<Page<CodAwaitingItem>> {
    return this.payments.awaitingCod(auth, query);
  }

  /**
   * Bulk "COD settled": every order or none, each with its own COD payment. Needs an
   * Idempotency-Key, so a retried remittance is never recorded twice (§9.8, ADR-007).
   */
  @Post('settle')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async settle(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() key: string,
    @Body(new ZodBodyPipe(codBulkSettleSchema)) input: CodBulkSettleInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CodBulkSettled> {
    const result = await this.idempotency.execute(
      auth,
      { key, endpoint: 'POST /cod/settle', payload: input },
      (tx) => this.payments.settleCodBulk(tx, auth, input),
      200,
      { timeoutMs: BULK_SETTLE_TIMEOUT_MS },
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}
