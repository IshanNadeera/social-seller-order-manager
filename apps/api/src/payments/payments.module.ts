import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { CodController } from './cod.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Payments and refunds (§7.7), and settling cash on delivery (§7.8). */
@Module({
  imports: [IdempotencyModule],
  controllers: [PaymentsController, CodController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
