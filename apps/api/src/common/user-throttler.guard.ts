import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** 300 requests per minute per signed-in user (docs/DEVELOPMENT.md §9.8). */
export const RATE_LIMIT = { ttl: 60_000, limit: 300 } as const;

/**
 * Rate limit keyed by the verified user, so one busy seller cannot slow down others and people
 * behind the same mobile-network address are not limited together. Requests without a verified
 * user (public routes such as /health) are keyed by IP address.
 * Registered after AuthGuard (src/auth/auth.module.ts), so req.user is already set.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    // req.user is set for every verified token, including users who have not onboarded yet.
    const user = request['user'] as { userId?: unknown } | undefined;
    if (typeof user?.userId === 'string') return Promise.resolve(`user:${user.userId}`);
    const ip = request['ip'];
    return Promise.resolve(`ip:${typeof ip === 'string' ? ip : 'unknown'}`);
  }
}
