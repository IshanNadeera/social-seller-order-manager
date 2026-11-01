import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { JWTVerifyGetKey } from 'jose';
import type { Env } from '../common/env';
import { ENV } from '../common/env.module';
import { RATE_LIMIT, UserThrottlerGuard } from '../common/user-throttler.guard';
import { AccountService } from './account.service';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { createSupabaseJwks } from './jwks';
import { SupabaseJwtVerifier } from './jwt-verifier';

/** Injection token for the signing-key resolver. Tests override it with a local key set. */
export const JWKS = Symbol('JWKS');

/**
 * Authentication and tenant context (§11.1, §11.2, ADR-003): verifies Supabase access tokens and
 * loads the caller's business membership on every non-public route. Also applies the per-user rate
 * limit (§9.8), which must run after AuthGuard so it can key on the verified user.
 */
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ...RATE_LIMIT }] })],
  controllers: [MeController],
  providers: [
    { provide: JWKS, inject: [ENV], useFactory: (env: Env) => createSupabaseJwks(env) },
    {
      provide: SupabaseJwtVerifier,
      inject: [JWKS, ENV],
      useFactory: (keys: JWTVerifyGetKey, env: Env) =>
        new SupabaseJwtVerifier(keys, env.SUPABASE_JWT_ISSUER),
    },
    AccountService,
    MeService,
    // Global guards run in registration order: authenticate first, then rate-limit by user.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
  exports: [SupabaseJwtVerifier, MeService],
})
export class AuthModule {}
