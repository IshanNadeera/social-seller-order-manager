import { Controller, Get, Header, Req } from '@nestjs/common';
import type { MeResponse } from '@ssom/shared';
import type { MembershipOptionalRequest } from './auth-context';
import { MeService } from './me.service';
import { AllowWithoutMembership } from './membership-optional.decorator';

/** GET /api/v1/me (docs/DEVELOPMENT.md §9.1): who am I, and do I still need to onboard? */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @AllowWithoutMembership()
  @Header('Cache-Control', 'no-store')
  get(@Req() request: MembershipOptionalRequest): Promise<MeResponse> {
    return this.me.get(request.user, request.auth);
  }
}
