import { Injectable } from '@nestjs/common';
import { localDateRangeToUtc } from '@ssom/shared';
import type { SalesReport, SalesReportQuery } from '@ssom/shared';
import type { AuthContext } from '../auth/auth-context';
import { PrismaService } from '../common/prisma.service';
import { periodFigures } from '../dashboard/metrics';
import { averageOrderValue, salesByDay, salesBySource, topItems } from './sales';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /reports/sales (§9.4, §2.2). Read in one REPEATABLE READ transaction, so the totals and the
   * breakdowns describe the same moment and always add up.
   */
  async sales(auth: AuthContext, query: SalesReportQuery): Promise<SalesReport> {
    return this.prisma.$transaction(
      async (tx) => {
        const { timezone: timeZone } = await tx.business.findUniqueOrThrow({
          where: { id: auth.businessId },
          select: { timezone: true },
        });
        const { gte, lt } = localDateRangeToUtc(query, timeZone);
        if (gte === undefined || lt === undefined)
          throw new Error('reports: both dates are required');
        const bounds = { gte, lt };
        const period = await periodFigures(tx, auth, bounds);
        return {
          timeZone,
          from: query.from,
          to: query.to,
          totals: {
            ordersCreated: period.ordersCreated,
            cancelled: period.cancelled,
            orderValue: period.orderValue,
            averageOrderValue: await averageOrderValue(tx, auth, bounds),
            paymentsReceived: period.paymentsReceived,
            refunds: period.refunds,
            netReceived: period.netReceived,
          },
          byDay: await salesByDay(tx, auth, bounds, timeZone),
          bySource: await salesBySource(tx, auth, bounds),
          topItems: await topItems(tx, auth, bounds),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
