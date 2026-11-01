// Tenant scoping helpers (docs/DEVELOPMENT.md §11.1, §9.7). Every query on a tenant-owned table goes
// through these, with the scope taken from req.auth via @CurrentAuth(), never from the request.
//
//   async get(auth: TenantScope, id: string) {
//     return orNotFound(await this.prisma.customer.findFirst({ where: tenantWhere(auth, { id }) }));
//   }
import { NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context';

/** What a service needs to scope a query: the business from the verified membership. */
export type TenantScope = Pick<AuthContext, 'businessId'>;

/**
 * Adds the tenant filter to a Prisma `where`. businessId is applied last, so it always wins over
 * anything in `where`, even a businessId that slipped in by mistake.
 */
export function tenantWhere<Where extends object>(
  scope: TenantScope,
  where: Where,
): Where & { businessId: string } {
  return { ...where, businessId: scope.businessId };
}

/** Adds the tenant to the data of a create. businessId is applied last, so it always wins. */
export function tenantData<Data extends object>(
  scope: TenantScope,
  data: Data,
): Data & { businessId: string } {
  return { ...data, businessId: scope.businessId };
}

/**
 * The single 404 for "not found" AND "belongs to another business" (§9.7: never reveal which).
 * Always use this, so both cases produce exactly the same response.
 */
export function notFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
}

/** Returns the row, or throws the standard 404 when the scoped lookup found nothing. */
export function orNotFound<Row>(row: Row | null | undefined): Row {
  if (row === null || row === undefined) throw notFound();
  return row;
}

/** For updateMany / deleteMany results: zero rows touched means not found (or another tenant's). */
export function assertTouched(result: { count: number }): void {
  if (result.count === 0) throw notFound();
}
