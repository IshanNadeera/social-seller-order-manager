// The customer search filter (docs/DEVELOPMENT.md §6.6, §7.11, §9.2), kept separate so it can be
// unit-tested without a database.
import { phoneSearchDigits } from '@ssom/shared';
import { tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/**
 * Prisma `where` for GET /customers, always scoped to the caller's business.
 * - Archived customers are left out unless asked for.
 * - `q` matches any part of the name (case-insensitive; the trigram index serves ILIKE '%q%'), any
 *   part of the phone as typed (finds numbers that could not be normalised), or, when `q` has at
 *   least 9 digits, the last 9 digits of the normalised phone. That makes 0771234567,
 *   +94 77 123 4567 and 771234567 find the same customer.
 * Prisma does NOT escape LIKE wildcards: it builds `'%' || value || '%'` as is (prisma-engines,
 * sql-query-builder filter/visitor.rs). So `%`, `_` and `\` in the search text are escaped here, or a
 * search for "_" would match every customer.
 */
export function customerSearchWhere(
  scope: TenantScope,
  q: string | undefined,
  includeArchived: boolean,
): Prisma.CustomerWhereInput & { businessId: string } {
  const filters: Prisma.CustomerWhereInput[] = [];
  if (!includeArchived) filters.push({ archivedAt: null });
  if (q !== undefined && q !== '') {
    const text = escapeLike(q);
    const anyOf: Prisma.CustomerWhereInput[] = [
      { name: { contains: text, mode: 'insensitive' } },
      { phoneDisplay: { contains: text } },
    ];
    const digits = phoneSearchDigits(q);
    if (digits !== null) anyOf.push({ phoneNormalized: { endsWith: digits } });
    filters.push({ OR: anyOf });
  }
  return tenantWhere(scope, { AND: filters });
}

/** Makes text match literally inside LIKE / ILIKE (PostgreSQL's default escape character is \\). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Stable order for paging (§6.3): by name, then ID, so equal names never swap between pages. */
export const CUSTOMER_LIST_ORDER: Prisma.CustomerOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];
