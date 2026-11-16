import { Injectable } from '@nestjs/common';
import { localDateOf, localDateRangeToUtc } from '@ssom/shared';
import type { DashboardSummary, DashboardSummaryQuery } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { currentState, ordersCreated, periodFigures } from './metrics';
import type { Bounds } from './metrics';

/** Local dates [from, to] in `timeZone` → UTC bounds [gte, lt) (§9.5, ADR-015). */
function bounds(from: string, to: string, timeZone: string): Bounds {
  const { gte, lt } = localDateRangeToUtc({ from, to }, timeZone);
  if (gte === undefined || lt === undefined) throw new Error('dashboard: both dates are required');
  return { gte, lt };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /dashboard/summary (§6.2, §15). Every figure is read in one REPEATABLE READ transaction, so
   * they all describe the same moment, even while orders are being saved.
   */
  async summary(
    auth: AuthContext,
    query: DashboardSummaryQuery,
    now: Date = new Date(),
  ): Promise<DashboardSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const { timezone: timeZone } = await tx.business.findUniqueOrThrow({
          where: { id: auth.businessId },
          select: { timezone: true },
        });
        const today = localDateOf(now, timeZone);
        const from = query.from ?? today;
        const to = query.to ?? today;
        return {
          timeZone,
          today: {
            date: today,
            ordersCreated: await ordersCreated(tx, auth, bounds(today, today, timeZone)),
          },
          now: await currentState(tx, auth),
          period: { from, to, ...(await periodFigures(tx, auth, bounds(from, to, timeZone))) },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
