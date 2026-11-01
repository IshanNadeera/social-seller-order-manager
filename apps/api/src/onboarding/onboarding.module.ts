import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/** First-run setup: creates the signed-in user's business (§9.1). */
@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
