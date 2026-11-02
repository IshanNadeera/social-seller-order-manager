import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Customers and their saved addresses (§9.2). */
@Module({
  controllers: [CustomersController, AddressesController],
  providers: [CustomersService, AddressesService],
  exports: [CustomersService],
})
export class CustomersModule {}
