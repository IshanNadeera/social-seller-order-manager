import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { suggestOrderPrefix } from '@ssom/shared';
import type { MemberRole, OnboardingInput } from '@ssom/shared';
import type { VerifiedUser } from '../auth/jwt-verifier';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '../generated/prisma/client';

export interface OnboardingResult {
  /** False when the user already had a business (the request was a repeat). */
  created: boolean;
  businessId: string;
  role: MemberRole;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /onboarding (docs/DEVELOPMENT.md §9.1, §7.12, ADR-010). In ONE transaction:
   * 1. Create or refresh the users row from the verified token, then lock it, so concurrent
   *    onboarding requests from the same user run one after the other.
   * 2. If the user already has a business, return it unchanged (idempotent per user).
   * 3. Otherwise create the business, its order counter (next = 1) and the OWNER membership.
   */
  async onboard(user: VerifiedUser, input: OnboardingInput): Promise<OnboardingResult> {
    if (user.email === null) {
      throw new UnprocessableEntityException({
        code: 'EMAIL_REQUIRED',
        message: 'Your account has no email address. Sign up with an email to continue.',
      });
    }
    const { userId, email } = user;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO app.users (id, email, updated_at)
          VALUES (${userId}::uuid, ${email}, now())
          ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`;
        await tx.$queryRaw`SELECT id FROM app.users WHERE id = ${userId}::uuid FOR UPDATE`;

        const existing = await tx.businessMember.findFirst({
          where: { userId, business: { archivedAt: null } },
          orderBy: [{ createdAt: 'asc' }, { businessId: 'asc' }],
          select: { businessId: true, role: true },
        });
        if (existing !== null) return { created: false, ...existing };

        const business = await tx.business.create({
          data: {
            name: input.businessName,
            contactPhone: input.contactPhone,
            orderPrefix: input.orderPrefix ?? suggestOrderPrefix(input.businessName),
            counter: { create: { nextOrderSeq: 1 } },
            members: { create: { userId, role: 'OWNER' } },
          },
          select: { id: true },
        });
        return { created: true, businessId: business.id, role: 'OWNER' as const };
      });
    } catch (error) {
      // users.email is unique: another account row still has this address.
      if (isEmailTaken(error)) {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message:
            'This email address is already linked to another account. Please contact support.',
        });
      }
      throw error;
    }
  }
}

/**
 * True when the users.email unique constraint (users_email_key) was violated. The insert is raw SQL,
 * so Prisma may report it as P2002 or wrap it as a raw-query error; the constraint name is in both.
 */
function isEmailTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const text = `${error.message} ${JSON.stringify(error.meta ?? {})}`;
  return text.includes('users_email_key') || (error.code === 'P2002' && text.includes('email'));
}
