import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Orders (§7, §9.4). */
@Module({
  imports: [IdempotencyModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
