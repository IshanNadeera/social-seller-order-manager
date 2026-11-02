import { Body, Controller, Header, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { addressCreateSchema, addressUpdateSchema } from '@ssom/shared';
import type { AddressCreateInput, AddressUpdateInput, CustomerDetail } from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { AddressesService } from './addresses.service';

/**
 * /api/v1/customers/:id/addresses (docs/DEVELOPMENT.md §9.2). Each route answers with the whole
 * customer (CustomerDetail), because a change can move the default to another address.
 */
@Controller('customers/:id/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  add(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) customerId: string,
    @Body(new ZodBodyPipe(addressCreateSchema)) input: AddressCreateInput,
  ): Promise<CustomerDetail> {
    return this.addresses.add(auth, customerId, input);
  }

  @Patch(':addressId')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) customerId: string,
    @Param('addressId', IdParamPipe) addressId: string,
    @Body(new ZodBodyPipe(addressUpdateSchema)) input: AddressUpdateInput,
  ): Promise<CustomerDetail> {
    return this.addresses.update(auth, customerId, addressId, input);
  }

  @Post(':addressId/archive')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) customerId: string,
    @Param('addressId', IdParamPipe) addressId: string,
  ): Promise<CustomerDetail> {
    return this.addresses.archive(auth, customerId, addressId);
  }
}
