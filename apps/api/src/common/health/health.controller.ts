import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';

export interface HealthResponse {
  status: 'ok';
}

/**
 * Liveness check at GET /api/v1/health. No authentication; reveals no configuration.
 * Task A15 adds the database ping (docs/DEVELOPMENT.md §11.7).
 */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
