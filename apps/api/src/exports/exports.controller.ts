import { Controller, Get, Header, HttpException, HttpStatus, Query, Res } from '@nestjs/common';
import { EXPORTS_PER_HOUR, orderExportQuerySchema } from '@ssom/shared';
import type { OrderExportQuery } from '@ssom/shared';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodQueryPipe } from '../common/zod-body.pipe';
import { ExportLimit } from './export-limit';
import { ExportsService } from './exports.service';

/** /api/v1/exports (docs/DEVELOPMENT.md §9.4, §11.4). */
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly limit: ExportLimit,
  ) {}

  /**
   * The business's orders as CSV, with the orders list's search and filters. At most
   * EXPORTS_PER_HOUR a business per hour: one more gets 429 with Retry-After.
   */
  @Get('orders.csv')
  @Header('Cache-Control', 'no-store')
  async orders(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(orderExportQuerySchema)) query: OrderExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const wait = this.limit.waitSeconds(auth.businessId);
    if (wait !== null) {
      res.setHeader('Retry-After', String(wait));
      throw new HttpException(
        {
          code: 'EXPORT_RATE_LIMITED',
          message: `You can export ${EXPORTS_PER_HOUR} times an hour. Please try again in ${Math.ceil(wait / 60)} minutes.`,
          fieldErrors: {},
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { csv, filename } = await this.exports.ordersCsv(auth, query);
    this.limit.record(auth.businessId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
