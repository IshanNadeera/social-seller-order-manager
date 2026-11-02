// The product search filter (docs/DEVELOPMENT.md §6.7, §9.3), kept separate so it can be unit-tested
// without a database.
import { escapeLike } from '../common/like';
import { tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/**
 * Prisma `where` for GET /products, always scoped to the caller's business. Archived products are
 * left out unless asked for. `q` matches any part of the name or the SKU, ignoring case; it goes
 * through escapeLike(), so `%` and `_` match literally.
 */
export function productSearchWhere(
  scope: TenantScope,
  q: string | undefined,
  includeArchived: boolean,
): Prisma.ProductWhereInput & { businessId: string } {
  const filters: Prisma.ProductWhereInput[] = [];
  if (!includeArchived) filters.push({ archivedAt: null });
  if (q !== undefined && q !== '') {
    const text = escapeLike(q);
    filters.push({
      OR: [
        { name: { contains: text, mode: 'insensitive' } },
        { sku: { contains: text, mode: 'insensitive' } },
      ],
    });
  }
  return tenantWhere(scope, { AND: filters });
}

/** Stable order for paging (§6.3): by name, then ID, so equal names never swap between pages. */
export const PRODUCT_LIST_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];
