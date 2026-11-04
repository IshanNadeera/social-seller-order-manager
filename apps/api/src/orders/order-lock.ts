// Row lock for changes to one order (docs/DEVELOPMENT.md §7.4, §7.2): edits, status changes and
// payments on the same order run one after another, each seeing the other's committed result.
import type { AuthContext } from '../auth/auth-context';
import { notFound } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

/** Locks the order row for this transaction; the standard 404 if it isn't this business's. */
export async function lockOrder(
  tx: Prisma.TransactionClient,
  scope: Pick<AuthContext, 'businessId'>,
  id: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}
