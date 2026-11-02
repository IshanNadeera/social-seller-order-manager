// Shared by the customer and address services (docs/DEVELOPMENT.md §8.3, §9.2).
import { UnprocessableEntityException } from '@nestjs/common';
import { notFound } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/** 422 for any change to an archived customer or their addresses. */
export function customerArchivedError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CUSTOMER_ARCHIVED',
    message: 'This customer is archived, so their details can no longer be changed.',
  });
}

/**
 * Locks the customer's row for the rest of the transaction (SELECT … FOR UPDATE), so changes to
 * the same customer's addresses run one after another. Without it, two requests making different
 * addresses the default at the same moment could both clear the old default and collide on the
 * one-default index. Throws the standard 404 for a missing or other-business customer, and 422 for
 * an archived one. Scoped by business explicitly: raw SQL cannot use tenantWhere().
 */
export async function lockActiveCustomer(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  customerId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ archived_at: Date | null }[]>`
    SELECT archived_at FROM app.customers
    WHERE business_id = ${scope.businessId}::uuid AND id = ${customerId}::uuid
    FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) throw notFound();
  if (row.archived_at !== null) throw customerArchivedError();
}
