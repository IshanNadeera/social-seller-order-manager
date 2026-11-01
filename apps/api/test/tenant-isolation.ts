// Cross-tenant test helper (docs/DEVELOPMENT.md §11.1, §12.4). Used by every endpoint's isolation
// tests (B5, C17, D9): business A must get exactly the same 404 for business B's IDs as for IDs that
// do not exist, so responses never reveal another business's records.
//
//   const tenants = await createTwoTenants(prisma, auth);
//   const customerOfB = ...create in tenants.b.businessId...
//   await expectCrossTenant404(server, tenants.a, { method: 'get', path: (id) => `/api/v1/customers/${id}` }, customerOfB);
//   await tenants.cleanup();
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { expect } from 'vitest';
import type { PrismaService } from '../src/common/prisma.service';
import type { TestAuth } from './test-auth';

export interface Tenant {
  userId: string;
  email: string;
  businessId: string;
  /** A valid access token for this tenant's owner. */
  token: string;
}

export interface TwoTenants {
  a: Tenant;
  b: Tenant;
  /** Deletes everything under both businesses (in foreign-key order) and both users. */
  cleanup(): Promise<void>;
}

/** Creates two independent businesses, each with an OWNER, an order counter and a token. */
export async function createTwoTenants(prisma: PrismaService, auth: TestAuth): Promise<TwoTenants> {
  const make = async (label: 'a' | 'b'): Promise<Tenant> => {
    const userId = randomUUID();
    const businessId = randomUUID();
    const email = `tenant-${label}-${userId}@example.test`;
    await prisma.user.create({ data: { id: userId, email } });
    await prisma.business.create({
      data: {
        id: businessId,
        name: `Tenant ${label.toUpperCase()} test business`,
        orderPrefix: label === 'a' ? 'TNA' : 'TNB',
        counter: { create: { nextOrderSeq: 1 } },
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    return { userId, email, businessId, token: await auth.sign(userId, email) };
  };
  const a = await make('a');
  const b = await make('b');
  return { a, b, cleanup: () => deleteTenants(prisma, [a, b]) };
}

/** Removes all rows of the given tenants, children first. Covers every tenant table in §8.2. */
export async function deleteTenants(prisma: PrismaService, tenants: Tenant[]): Promise<void> {
  const businessIds = tenants.map((t) => t.businessId);
  const userIds = tenants.map((t) => t.userId);
  await prisma.$transaction([
    prisma.orderEvent.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.delivery.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.payment.updateMany({
      where: { businessId: { in: businessIds }, refundOfPaymentId: { not: null } },
      data: { refundOfPaymentId: null },
    }),
    prisma.payment.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.orderItem.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.order.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.customerAddress.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.customer.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.product.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.idempotencyKey.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.businessMember.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.businessCounter.deleteMany({ where: { businessId: { in: businessIds } } }),
    prisma.business.deleteMany({ where: { id: { in: businessIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
}

export interface RouteUnderTest {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  /** Builds the path for a given record ID, e.g. (id) => `/api/v1/customers/${id}`. */
  path: (id: string) => string;
  /** JSON body for write routes. Must be valid, so only the ID decides the outcome. */
  body?: object;
}

/**
 * Asserts that `as` gets 404 for `foreignId` (a record of the other business), and that the
 * response is the same as for a random ID that exists nowhere. Only `requestId` may differ: it is
 * unique per request (§9.7) and says nothing about the record.
 */
export async function expectCrossTenant404(
  server: App,
  as: Tenant,
  route: RouteUnderTest,
  foreignId: string,
): Promise<void> {
  const call = (id: string) => {
    const req = request(server)
      [route.method](route.path(id))
      .set('Authorization', `Bearer ${as.token}`);
    return route.body === undefined ? req : req.send(route.body);
  };
  const foreign = await call(foreignId);
  const missing = await call(randomUUID());
  const where = `${route.method.toUpperCase()} ${route.path(':id')} as business ${as.businessId}`;
  expect(foreign.status, `${where} must answer 404 for another business's ID`).toBe(404);
  expect(withoutRequestId(foreign.body), `${where} must not reveal that the record exists`).toEqual(
    withoutRequestId(missing.body),
  );
  expect(missing.status).toBe(404);
}

/** An error body without its per-request ID, for comparing two responses. */
export function withoutRequestId(body: unknown): Record<string, unknown> {
  const { requestId, ...rest } = body as Record<string, unknown>;
  expect(typeof requestId, 'every error body carries a requestId').toBe('string');
  return rest;
}
