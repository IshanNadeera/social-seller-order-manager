import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  InvalidTokenError,
  SigningKeysUnavailableError,
  SupabaseJwtVerifier,
} from './jwt-verifier';
import type { VerifiedUser } from './jwt-verifier';
import { IS_PUBLIC } from './public.decorator';

/** A request that passed AuthGuard. A14 adds the business membership next to `user`. */
export interface AuthenticatedRequest extends Request {
  user: VerifiedUser;
}

// RFC 6750 token68 characters; JWTs use only base64url and dots.
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/** Returns the token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return BEARER.exec(header.trim())?.[1] ?? null;
}

/**
 * Global guard: every route needs a valid Supabase access token unless marked @Public()
 * (§9 "Every request except /health requires Authorization: Bearer", §11.2).
 * Never logs the token or the Authorization header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseJwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & Partial<AuthenticatedRequest>>();
    const token = bearerToken(request.headers.authorization);
    if (token === null) throw new UnauthorizedException();

    try {
      request.user = await this.verifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof SigningKeysUnavailableError) {
        this.logger.error('Rejected a request: Supabase signing keys are unavailable.');
        throw new ServiceUnavailableException();
      }
      if (error instanceof InvalidTokenError) {
        this.logger.debug(`Rejected an access token: ${error.message}`);
        throw new UnauthorizedException();
      }
      throw error;
    }
  }
}
