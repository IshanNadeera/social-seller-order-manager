import { Controller, Get, Header, Query } from '@nestjs/common';
import { salesReportQuerySchema } from '@ssom/shared';
import type { SalesReport, SalesReportQuery } from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodQueryPipe } from '../common/zod-body.pipe';
import { ReportsService } from './reports.service';

/** /api/v1/reports (docs/DEVELOPMENT.md §9.4). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Sales for `from`–`to` (local dates, both included, at most 366 days). */
  @Get('sales')
  @Header('Cache-Control', 'no-store')
  sales(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(salesReportQuerySchema)) query: SalesReportQuery,
  ): Promise<SalesReport> {
    return this.reports.sales(auth, query);
  }
}
