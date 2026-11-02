// Order numbers (docs/DEVELOPMENT.md §7.12, ADR-010): {PREFIX}-{N}, N zero-padded to 4 digits.
import { formatOrderNumber } from '@ssom/shared';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

export interface AllocatedOrderNumber {
  sequence: number;
  orderNumber: string;
}

/**
 * Takes the business's next order number. Call it INSIDE the order-creation transaction:
 * - the UPDATE locks the counter row, so concurrent creations for one business wait their turn and
 *   each gets its own number;
 * - if the transaction rolls back, the number is not used (gaps are acceptable, §7.12);
 * - the prefix is read in the same statement, so a prefix change applies to new orders only.
 * UNIQUE (business_id, order_number) stays the final guarantee.
 */
export async function allocateOrderNumber(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
): Promise<AllocatedOrderNumber> {
  const rows = await tx.$queryRaw<{ sequence: number; prefix: string }[]>`
    UPDATE app.business_counters AS c
    SET next_order_seq = c.next_order_seq + 1
    FROM app.businesses AS b
    WHERE c.business_id = ${scope.businessId}::uuid AND b.id = c.business_id
    RETURNING c.next_order_seq - 1 AS sequence, b.order_prefix AS prefix`;
  const [row] = rows;
  // Every business gets its counter at onboarding (§8.2); a missing one is a bug, not a user error.
  if (row === undefined) throw new Error('No order counter for this business.');
  const sequence = Number(row.sequence);
  return { sequence, orderNumber: formatOrderNumber(row.prefix, sequence) };
}
