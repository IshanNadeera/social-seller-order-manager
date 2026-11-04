import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  customerCreateSchema,
  customerListQuerySchema,
  customerOrdersQuerySchema,
  customerUpdateSchema,
} from '@ssom/shared';
import type {
  CustomerCreateInput,
  CustomerDetail,
  CustomerListQuery,
  CustomerOrdersQuery,
  CustomerSummary,
  CustomerUpdateInput,
  OrderSummary,
  Page,
} from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe, ZodQueryPipe } from '../common/zod-body.pipe';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from './customers.service';

/**
 * /api/v1/customers (docs/DEVELOPMENT.md §9.2), and a customer's order history. Addresses are B3.
 * Responses hold personal data, so browsers and proxies are told not to store them.
 */
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(customerListQuerySchema)) query: CustomerListQuery,
  ): Promise<Page<CustomerSummary>> {
    return this.customers.list(auth, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBodyPipe(customerCreateSchema)) input: CustomerCreateInput,
  ): Promise<CustomerDetail> {
    return this.customers.create(auth, input);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
  ): Promise<CustomerDetail> {
    return this.customers.get(auth, id);
  }

  /** The customer's orders, newest first, in pages (§9.2, §6.6). */
  @Get(':id/orders')
  @Header('Cache-Control', 'no-store')
  orderHistory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Query(new ZodQueryPipe(customerOrdersQuerySchema)) query: CustomerOrdersQuery,
  ): Promise<Page<OrderSummary>> {
    return this.orders.listForCustomer(auth, id, query);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(customerUpdateSchema)) input: CustomerUpdateInput,
  ): Promise<CustomerDetail> {
    return this.customers.update(auth, id, input);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
  ): Promise<CustomerDetail> {
    return this.customers.archive(auth, id);
  }
}
