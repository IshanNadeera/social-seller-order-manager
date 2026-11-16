import { Controller, Get, Header, Query } from '@nestjs/common';
import { dashboardSummaryQuerySchema } from '@ssom/shared';
import type { DashboardSummary, DashboardSummaryQuery } from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodQueryPipe } from '../common/zod-body.pipe';
import { DashboardService } from './dashboard.service';

/** /api/v1/dashboard (docs/DEVELOPMENT.md §6.2, §15). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** The dashboard figures: today, right now, and for `from`–`to` (local dates; default today). */
  @Get('summary')
  @Header('Cache-Control', 'no-store')
  summary(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(dashboardSummaryQuerySchema)) query: DashboardSummaryQuery,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(auth, query);
  }
}
