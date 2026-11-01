import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { onboardingRequestSchema } from '@ssom/shared';
import type { MeResponse, OnboardingInput } from '@ssom/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth-context';
import type { VerifiedUser } from '../auth/jwt-verifier';
import { MeService } from '../auth/me.service';
import { AllowWithoutMembership } from '../auth/membership-optional.decorator';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { OnboardingService } from './onboarding.service';

/** POST /api/v1/onboarding (docs/DEVELOPMENT.md §9.1). */
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly me: MeService,
  ) {}

  /**
   * Creates the caller's business. Answers 201 the first time and 200 for a repeat (the existing
   * business, unchanged). Either way the body is the same as GET /me, so the app can move on.
   */
  @Post()
  @AllowWithoutMembership()
  async create(
    @CurrentUser() user: VerifiedUser,
    @Body(new ZodBodyPipe(onboardingRequestSchema)) input: OnboardingInput,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.onboarding.onboard(user, input);
    const body: MeResponse = await this.me.get(user, {
      userId: user.userId,
      businessId: result.businessId,
      role: result.role,
    });
    response
      .status(result.created ? HttpStatus.CREATED : HttpStatus.OK)
      .setHeader('Cache-Control', 'no-store')
      .json(body);
  }
}
