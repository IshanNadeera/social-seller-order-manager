// The order list filter (docs/DEVELOPMENT.md §6.3, §9.5), kept apart so it can be unit-tested.
import { localDateRangeToUtc, phoneSearchDigits } from '@ssom/shared';
import type { OrderListQuery } from '@ssom/shared';
import { escapeLike } from '../common/like';
import { tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/**
 * Prisma `where` for GET /orders, always scoped to the caller's business.
 * - Each status / source filter narrows the list; delivery status looks at the order's delivery.
 * - `from`/`to` are local dates in the business timezone → [from 00:00, to+1 00:00) in UTC (ADR-015).
 * - `q` matches the order number, the customer name or phone saved on the order, or (9+ digits) the
 *   last 9 digits of the customer's normalised phone. Wildcards in `q` match literally.
 */
export function orderListWhere(
  scope: TenantScope,
  query: OrderListQuery,
  timeZone: string,
): Prisma.OrderWhereInput & { businessId: string } {
  const filters: Prisma.OrderWhereInput[] = [];
  if (query.orderStatus) filters.push({ orderStatus: query.orderStatus });
  if (query.paymentStatus) filters.push({ paymentStatus: query.paymentStatus });
  if (query.sourceChannel) filters.push({ sourceChannel: query.sourceChannel });
  if (query.deliveryStatus) filters.push({ delivery: { is: { status: query.deliveryStatus } } });
  const createdAt = localDateRangeToUtc({ from: query.from, to: query.to }, timeZone);
  if (createdAt.gte !== undefined || createdAt.lt !== undefined) filters.push({ createdAt });
  if (query.q !== undefined && query.q !== '') {
    const text = escapeLike(query.q);
    const anyOf: Prisma.OrderWhereInput[] = [
      { orderNumber: { contains: text, mode: 'insensitive' } },
      { customerNameSnapshot: { contains: text, mode: 'insensitive' } },
      { customerPhoneSnapshot: { contains: text } },
    ];
    const digits = phoneSearchDigits(query.q);
    if (digits !== null)
      anyOf.push({ customer: { is: { phoneNormalized: { endsWith: digits } } } });
    filters.push({ OR: anyOf });
  }
  return tenantWhere(scope, { AND: filters });
}

/** Newest first, and stable across pages (§6.3). */
export const ORDER_LIST_ORDER: Prisma.OrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];
