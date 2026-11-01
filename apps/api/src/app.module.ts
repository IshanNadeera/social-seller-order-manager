import { Module } from '@nestjs/common';
import { HealthModule } from './common/health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
