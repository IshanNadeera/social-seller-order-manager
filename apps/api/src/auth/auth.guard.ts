import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountService } from './account.service';
import type { MembershipOptionalRequest } from './auth-context';
import {
  InvalidTokenError,
  SigningKeysUnavailableError,
  SupabaseJwtVerifier,
} from './jwt-verifier';
import { IS_MEMBERSHIP_OPTIONAL } from './membership-optional.decorator';
import { IS_PUBLIC } from './public.decorator';

export type { AuthContext, AuthenticatedRequest } from './auth-context';

// RFC 6750 token68 characters; JWTs use only base64url and dots.
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/** Returns the token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return BEARER.exec(header.trim())?.[1] ?? null;
}

/** Error codes the web app acts on (the full error shape arrives in A18). */
export const AUTH_ERROR_CODES = {
  accountDisabled: 'ACCOUNT_DISABLED',
  onboardingRequired: 'ONBOARDING_REQUIRED',
} as const;

/**
 * Global guard (docs/DEVELOPMENT.md §9, §11.1, §11.2), in this order:
 * 1. @Public() routes pass without a token.
 * 2. Verify the Supabase access token → req.user (401 if invalid, 503 if keys are unreachable).
 * 3. Load the account: disabled → 403 on every route.
 * 4. Membership → req.auth = { userId, businessId, role }. None → 403, except on
 *    @AllowWithoutMembership() routes (/me, /onboarding).
 * Never logs the token or the Authorization header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseJwtVerifier,
    private readonly accounts: AccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.flag(IS_PUBLIC, context)) return true;

    const request = context.switchToHttp().getRequest<Partial<MembershipOptionalRequest>>();
    const token = bearerToken(request.headers?.authorization);
    if (token === null) throw new UnauthorizedException();

    try {
      request.user = await this.verifier.verify(token);
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

    const userId = request.user.userId;
    const account = await this.accounts.load(userId);
    if (account.status === 'disabled') {
      throw new ForbiddenException({
        code: AUTH_ERROR_CODES.accountDisabled,
        message: 'This account has been disabled. Please contact support.',
      });
    }
    if (account.status === 'member') {
      request.auth = { userId, businessId: account.businessId, role: account.role };
      return true;
    }
    if (this.flag(IS_MEMBERSHIP_OPTIONAL, context)) return true;
    throw new ForbiddenException({
      code: AUTH_ERROR_CODES.onboardingRequired,
      message: 'Finish setting up your business first.',
    });
  }

  private flag(key: string, context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
