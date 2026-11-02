import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { productCreateSchema, productListQuerySchema, productUpdateSchema } from '@ssom/shared';
import type {
  Page,
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
  ProductView,
} from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { IdParamPipe } from '../common/id-param.pipe';
import { ZodBodyPipe, ZodQueryPipe } from '../common/zod-body.pipe';
import { ProductsService } from './products.service';

/** /api/v1/products (docs/DEVELOPMENT.md §9.3). */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodQueryPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<Page<ProductView>> {
    return this.products.list(auth, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBodyPipe(productCreateSchema)) input: ProductCreateInput,
  ): Promise<ProductView> {
    return this.products.create(auth, input);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
  ): Promise<ProductView> {
    return this.products.get(auth, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(productUpdateSchema)) input: ProductUpdateInput,
  ): Promise<ProductView> {
    return this.products.update(auth, id, input);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
  ): Promise<ProductView> {
    return this.products.archive(auth, id);
  }
}
