import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import type { Env } from './common/env';
import { EnvModule } from './common/env.module';
import { HealthModule } from './common/health/health.module';
import { PrismaModule } from './common/prisma.module';
import { CustomersModule } from './customers/customers.module';
import { OnboardingModule } from './onboarding/onboarding.module';

@Module({})
export class AppModule {
  /** The root module, built from the environment validated in main.ts (or a test environment). */
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        PrismaModule,
        AuthModule,
        HealthModule,
        OnboardingModule,
        CustomersModule,
      ],
    };
  }
}
