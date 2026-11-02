import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** Idempotency-Key handling (§9.8). Import it in modules whose create endpoints need a key. */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
