import { Injectable } from '@nestjs/common';
import type { MemberRole } from '@ssom/shared';
import { PrismaService } from '../common/prisma.service';

/** What the API knows about a verified user's account (docs/DEVELOPMENT.md §11.2). */
export type AccountState =
  | { status: 'disabled' }
  | { status: 'no-membership' }
  | { status: 'member'; businessId: string; role: MemberRole };

/** Loads the account state AuthGuard needs: one indexed lookup per request. */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * - users.disabled_at set → disabled (refused everywhere).
   * - No users row yet (signed up, not onboarded) or no membership in a non-archived business → no-membership.
   * - Otherwise the membership. MVP users have one; if several exist (STAFF, later), the oldest wins
   *   so the choice is deterministic. Choosing between businesses is not in the MVP.
   */
  async load(userId: string): Promise<AccountState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        disabledAt: true,
        memberships: {
          where: { business: { archivedAt: null } },
          orderBy: [{ createdAt: 'asc' }, { businessId: 'asc' }],
          take: 1,
          select: { businessId: true, role: true },
        },
      },
    });
    if (user === null) return { status: 'no-membership' };
    if (user.disabledAt !== null) return { status: 'disabled' };
    const membership = user.memberships[0];
    if (membership === undefined) return { status: 'no-membership' };
    return { status: 'member', businessId: membership.businessId, role: membership.role };
  }
}
