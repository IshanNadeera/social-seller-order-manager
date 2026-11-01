import { Controller, Get, Header, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@ssom/shared';
import { Public } from '../../auth/public.decorator';
import { PrismaService } from '../prisma.service';

/** Longest the health check waits for the database before reporting it unreachable. */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

/**
 * GET /api/v1/health (docs/DEVELOPMENT.md §9.1, §11.7): process up + database ping.
 * No authentication. Reveals no configuration: no versions, hosts or error details, ever.
 * 200 when the database answers; 503 otherwise, so uptime monitors alert.
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(): Promise<HealthResponse> {
    if (await this.databaseAnswers()) return { status: 'ok', database: 'ok' };
    const body: HealthResponse = { status: 'error', database: 'unreachable' };
    throw new ServiceUnavailableException(body);
  }

  private async databaseAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), HEALTH_DB_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      if (result === 'timeout') {
        this.logger.warn(
          `Health check: database did not answer within ${HEALTH_DB_TIMEOUT_MS} ms.`,
        );
        return false;
      }
      return true;
    } catch (error) {
      // Logged for operators only; the response never includes it.
      this.logger.warn(
        `Health check: database query failed (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
