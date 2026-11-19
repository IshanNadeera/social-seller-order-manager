import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import { businessUpdateSchema } from '@ssom/shared';
import type { BusinessUpdateInput, BusinessView } from '@ssom/shared';
import { CurrentAuth } from '../auth/auth-context';
import type { AuthContext } from '../auth/auth-context';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { BusinessesService } from './businesses.service';

/** /api/v1/business: the caller's own business profile (docs/DEVELOPMENT.md §6.8, §9.1). */
@Controller('business')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): Promise<BusinessView> {
    return this.businesses.get(auth);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBodyPipe(businessUpdateSchema)) input: BusinessUpdateInput,
  ): Promise<BusinessView> {
    return this.businesses.update(auth, input);
  }
}
