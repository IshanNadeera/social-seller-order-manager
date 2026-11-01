import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { JWTVerifyGetKey } from 'jose';
import type { Env } from '../common/env';
import { ENV } from '../common/env.module';
import { AccountService } from './account.service';
import { AuthGuard } from './auth.guard';
import { createSupabaseJwks } from './jwks';
import { SupabaseJwtVerifier } from './jwt-verifier';

/** Injection token for the signing-key resolver. Tests override it with a local key set. */
export const JWKS = Symbol('JWKS');

/**
 * Authentication and tenant context (§11.1, §11.2, ADR-003): verifies Supabase access tokens and
 * loads the caller's business membership on every non-public route.
 */
@Module({
  providers: [
    { provide: JWKS, inject: [ENV], useFactory: (env: Env) => createSupabaseJwks(env) },
    {
      provide: SupabaseJwtVerifier,
      inject: [JWKS, ENV],
      useFactory: (keys: JWTVerifyGetKey, env: Env) =>
        new SupabaseJwtVerifier(keys, env.SUPABASE_JWT_ISSUER),
    },
    AccountService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SupabaseJwtVerifier],
})
export class AuthModule {}
