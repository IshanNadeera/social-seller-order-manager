// The dashboard figures (docs/DEVELOPMENT.md §15), implemented once, here. Each one follows its §15
// definition word for word; the comments quote it. "Period" is [from, to] local dates in the
// business timezone, given here as UTC bounds [gte, lt). Raw SQL can't use tenantWhere(), so every
// query names its business explicitly. Money comes back from Postgres as exact decimal text.
//
// Order value, money received and COD still with couriers are separate figures; nothing here adds
// them together (§6.2). A delivered COD order is not money received until it is settled.
import { tenantWhere } from '../common/tenant';
import type { TenantScope } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** UTC bounds of a run of local days: [gte, lt). */
export type Bounds = { gte: Date; lt: Date };

/** "Orders created": orders with created_at in the bounds, including cancelled ones. */
export function ordersCreated(tx: Tx, scope: TenantScope, bounds: Bounds): Promise<number> {
  return tx.order.count({ where: tenantWhere(scope, { createdAt: bounds }) });
}

/** The figures that describe the business right now, whatever the period. */
export async function currentState(tx: Tx, scope: TenantScope) {
  // "Orders needing action": order_status IN (NEW, PENDING_CONFIRMATION).
  const needingAction: Prisma.OrderWhereInput = {
    orderStatus: { in: ['NEW', 'PENDING_CONFIRMATION'] },
  };
  // "Ready to send": order_status = READY and delivery PENDING (or pickup not yet completed —
  // a READY pickup is not completed).
  const ready: Prisma.OrderWhereInput = {
    orderStatus: 'READY',
    OR: [{ delivery: { is: null } }, { delivery: { is: { status: 'PENDING' } } }],
  };
  const ordersNeedingAction = await tx.order.count({ where: tenantWhere(scope, needingAction) });
  const readyToSend = await tx.order.count({ where: tenantWhere(scope, ready) });
  const [orders] = await tx.$queryRaw<{ outstanding: string; refunds_owed: string }[]>`
    SELECT
      -- "Outstanding balance": total − (paid − refunded), not CANCELLED/RETURNED, where positive.
      COALESCE(SUM(GREATEST(total_amount - (amount_paid - amount_refunded), 0))
        FILTER (WHERE order_status NOT IN ('CANCELLED', 'RETURNED')), 0)::numeric(14, 2)::text
        AS outstanding,
      -- "Refunds owed": paid − refunded on CANCELLED/RETURNED orders, where positive.
      COALESCE(SUM(GREATEST(amount_paid - amount_refunded, 0))
        FILTER (WHERE order_status IN ('CANCELLED', 'RETURNED')), 0)::numeric(14, 2)::text
        AS refunds_owed
    FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid`;
  const [deliveries] = await tx.$queryRaw<
    { out_for_delivery: number; cod_out: string; cod_with_courier: string }[]
  >`
    SELECT
      -- "Out for delivery": delivery status = DISPATCHED.
      COUNT(*) FILTER (WHERE status = 'DISPATCHED')::int AS out_for_delivery,
      -- "COD out for delivery": cod_amount where cod_status = PENDING and delivery DISPATCHED.
      COALESCE(SUM(cod_amount) FILTER (WHERE cod_status = 'PENDING' AND status = 'DISPATCHED'), 0)
        ::numeric(14, 2)::text AS cod_out,
      -- "COD with courier": cod_amount where cod_status = COLLECTED.
      COALESCE(SUM(cod_amount) FILTER (WHERE cod_status = 'COLLECTED'), 0)::numeric(14, 2)::text
        AS cod_with_courier
    FROM app.deliveries
    WHERE business_id = ${scope.businessId}::uuid`;
  return {
    ordersNeedingAction,
    readyToSend,
    outForDelivery: deliveries?.out_for_delivery ?? 0,
    outstandingBalance: orders?.outstanding ?? '0.00',
    codOutForDelivery: deliveries?.cod_out ?? '0.00',
    codWithCourier: deliveries?.cod_with_courier ?? '0.00',
    refundsOwed: orders?.refunds_owed ?? '0.00',
  };
}

/** The figures for a period. */
export async function periodFigures(tx: Tx, scope: TenantScope, bounds: Bounds) {
  const [orders] = await tx.$queryRaw<
    { created: number; cancelled: number; order_value: string }[]
  >`
    SELECT
      -- "Orders created", including cancelled.
      COUNT(*)::int AS created,
      -- The "cancellation rate" cohort: of the orders created in the period, those cancelled.
      COUNT(*) FILTER (WHERE order_status = 'CANCELLED')::int AS cancelled,
      -- "Order value": total_amount of orders created in the period, excluding CANCELLED.
      COALESCE(SUM(total_amount) FILTER (WHERE order_status <> 'CANCELLED'), 0)::numeric(14, 2)::text
        AS order_value
    FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid
      AND created_at >= ${bounds.gte} AND created_at < ${bounds.lt}`;
  const [money] = await tx.$queryRaw<{ received: string; refunds: string; net: string }[]>`
    SELECT received::text, refunds::text, (received - refunds)::numeric(14, 2)::text AS net
    FROM (
      SELECT
        -- "Payments received": PAYMENT records with occurred_at in the period (settled COD included).
        COALESCE(SUM(amount) FILTER (WHERE type = 'PAYMENT'), 0)::numeric(14, 2) AS received,
        -- "Refunds": REFUND records with occurred_at in the period.
        COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0)::numeric(14, 2) AS refunds
      FROM app.payments
      WHERE business_id = ${scope.businessId}::uuid
        AND occurred_at >= ${bounds.gte} AND occurred_at < ${bounds.lt}
    ) AS sums`;
  // "Delivered": deliveries with delivered_at in the period.
  const delivered = await tx.delivery.count({
    where: tenantWhere(scope, { deliveredAt: bounds }),
  });
  const created = orders?.created ?? 0;
  const cancelled = orders?.cancelled ?? 0;
  return {
    ordersCreated: created,
    cancelled,
    // "Cancellation rate": cancelled ÷ orders created, same period cohort.
    cancellationRate: created === 0 ? null : cancelled / created,
    delivered,
    orderValue: orders?.order_value ?? '0.00',
    paymentsReceived: money?.received ?? '0.00',
    refunds: money?.refunds ?? '0.00',
    // "Net received": payments received − refunds (negative if refunds were larger).
    netReceived: money?.net ?? '0.00',
  };
}
