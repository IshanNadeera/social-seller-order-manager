// The caller's identity and tenant scope for one request (docs/DEVELOPMENT.md §11.1, §11.2).
import { InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { MemberRole } from '@ssom/shared';
import type { Request } from 'express';
import type { VerifiedUser } from './jwt-verifier';

/**
 * Set by AuthGuard from the verified token and the user's business membership.
 * `businessId` is the ONLY source of tenant scope: never take it from the body, query or path (§11.1).
 */
export interface AuthContext {
  userId: string;
  businessId: string;
  role: MemberRole;
}

/** A request on a normal (membership-required) route, after AuthGuard. */
export interface AuthenticatedRequest extends Request {
  user: VerifiedUser;
  auth: AuthContext;
}

/** A request on an @AllowWithoutMembership() route: the user is verified, membership may be missing. */
export interface MembershipOptionalRequest extends Request {
  user: VerifiedUser;
  auth?: AuthContext;
}

/**
 * Controller parameter: the request's AuthContext. On a normal route AuthGuard guarantees it;
 * a missing value means the route is public or membership-optional, which is a programming error.
 */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().auth;
  if (auth === undefined) {
    throw new InternalServerErrorException(); // e.g. @CurrentAuth() used on a @Public() route
  }
  return auth;
});

/** Controller parameter: the verified Supabase user (also on membership-optional routes). */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user;
  if (user === undefined) throw new InternalServerErrorException();
  return user;
});
