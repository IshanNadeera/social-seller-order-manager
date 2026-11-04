import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Payments and refunds (§7.7). */
@Module({
  imports: [IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
