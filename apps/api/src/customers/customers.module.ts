import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Customers, their saved addresses and their order history (§9.2). */
@Module({
  imports: [OrdersModule],
  controllers: [CustomersController, AddressesController],
  providers: [CustomersService, AddressesService],
  exports: [CustomersService],
})
export class CustomersModule {}
