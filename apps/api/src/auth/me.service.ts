import { Injectable, Logger } from '@nestjs/common';
import type { MeResponse } from '@ssom/shared';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { AuthContext } from './auth-context';
import type { VerifiedUser } from './jwt-verifier';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me (docs/DEVELOPMENT.md §9.1). `auth` is present only when AuthGuard found a membership;
   * without one the user still has to onboard. Disabled accounts never get here (AuthGuard → 403).
   */
  async get(user: VerifiedUser, auth: AuthContext | undefined): Promise<MeResponse> {
    await this.syncEmail(user);

    const row =
      auth === undefined
        ? null
        : await this.prisma.business.findUnique({
            where: { id: auth.businessId },
            select: {
              id: true,
              name: true,
              orderPrefix: true,
              currency: true,
              timezone: true,
              defaultDeliveryFee: true,
            },
          });
    const business =
      row === null ? null : { ...row, defaultDeliveryFee: row.defaultDeliveryFee.toFixed(2) };

    return {
      user: { id: user.userId, email: user.email },
      needsOnboarding: business === null,
      role: business === null ? null : (auth?.role ?? null),
      business,
    };
  }

  /**
   * Email changes in Supabase Auth reach app.users on the next /me call (§8.2). Only an existing
   * row is updated (onboarding creates it), and only when the email actually changed.
   */
  private async syncEmail(user: VerifiedUser): Promise<void> {
    if (user.email === null) return;
    try {
      await this.prisma.user.updateMany({
        where: { id: user.userId, NOT: { email: user.email } },
        data: { email: user.email },
      });
    } catch (error) {
      // Another app.users row still holds this address (e.g. a deleted Supabase account).
      // Keep serving /me; an operator has to resolve it. Never log the address itself.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(
          `Could not sync the email of user ${user.userId}: address already in use.`,
        );
        return;
      }
      throw error;
    }
  }
}
