// AccountService against the real database (docs/DEVELOPMENT.md §11.1, §11.2).
// Needs a migrated local database. Run with: npm run test:db -w apps/api
// Creates its own users and businesses with random IDs and deletes them afterwards.
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccountService } from '../src/auth/account.service';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';

describe('AccountService.load', () => {
  let prisma: PrismaService;
  let accounts: AccountService;
  let close: () => Promise<void>;

  const user = {
    member: randomUUID(),
    disabled: randomUUID(),
    noRow: randomUUID(), // signed up in Supabase Auth, never onboarded: no app.users row
    noMembership: randomUUID(),
    archivedOnly: randomUUID(),
    archivedAndActive: randomUUID(),
  };
  const business = {
    first: randomUUID(),
    later: randomUUID(),
    archived: randomUUID(),
    active: randomUUID(),
    disabledUsers: randomUUID(),
  };
  const userIds = Object.values(user);
  const businessIds = Object.values(business);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(process.env))],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    accounts = moduleRef.get(AccountService);
    close = () => moduleRef.close();

    const rowsFor = Object.entries(user).filter(([key]) => key !== 'noRow');
    await prisma.user.createMany({
      data: rowsFor.map(([key, id]) => ({
        id,
        email: `account-test-${key.toLowerCase()}-${id}@example.test`, // users_email_lower_chk
        disabledAt: key === 'disabled' ? new Date() : null,
      })),
    });
    await prisma.business.createMany({
      data: businessIds.map((id) => ({
        id,
        name: 'Account test business',
        archivedAt: id === business.archived ? new Date() : null,
      })),
    });
    const t = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
    await prisma.businessMember.createMany({
      data: [
        // Two memberships: the older one wins.
        { userId: user.member, businessId: business.later, role: 'STAFF', createdAt: t(20) },
        { userId: user.member, businessId: business.first, role: 'OWNER', createdAt: t(10) },
        {
          userId: user.disabled,
          businessId: business.disabledUsers,
          role: 'OWNER',
          createdAt: t(10),
        },
        {
          userId: user.archivedOnly,
          businessId: business.archived,
          role: 'OWNER',
          createdAt: t(10),
        },
        // The archived business is older but must be skipped.
        {
          userId: user.archivedAndActive,
          businessId: business.archived,
          role: 'STAFF',
          createdAt: t(5),
        },
        {
          userId: user.archivedAndActive,
          businessId: business.active,
          role: 'OWNER',
          createdAt: t(10),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it('returns the membership of a member (the oldest, if there are several)', async () => {
    await expect(accounts.load(user.member)).resolves.toEqual({
      status: 'member',
      businessId: business.first,
      role: 'OWNER',
    });
  });

  it('reports a disabled account even though it has a membership', async () => {
    await expect(accounts.load(user.disabled)).resolves.toEqual({ status: 'disabled' });
  });

  it('treats a user with no app.users row as having no membership', async () => {
    await expect(accounts.load(user.noRow)).resolves.toEqual({ status: 'no-membership' });
  });

  it('treats a user row without memberships as having no membership', async () => {
    await expect(accounts.load(user.noMembership)).resolves.toEqual({ status: 'no-membership' });
  });

  it('ignores memberships of archived (closed) businesses', async () => {
    await expect(accounts.load(user.archivedOnly)).resolves.toEqual({ status: 'no-membership' });
    await expect(accounts.load(user.archivedAndActive)).resolves.toEqual({
      status: 'member',
      businessId: business.active,
      role: 'OWNER',
    });
  });
});
