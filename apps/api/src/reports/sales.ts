// The sales report's breakdowns (docs/DEVELOPMENT.md §9.4, §2.2). They use the §15 definitions:
// "order value" is the total of orders created in the period, cancelled ones left out (not
// revenue), and money is counted by when it changed hands (occurred_at). Days are local dates in
// the business timezone. Raw SQL can't use tenantWhere(), so every query names its business.
import type { SalesReport } from '@ssom/shared';
import type { TenantScope } from '../common/tenant';
import type { Bounds } from '../dashboard/metrics';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** How many items the report lists. */
export const TOP_ITEMS = 10;

/** Order value ÷ orders not cancelled, to the cent; null when every order was cancelled. */
export async function averageOrderValue(tx: Tx, scope: TenantScope, bounds: Bounds) {
  const [row] = await tx.$queryRaw<{ average: string | null }[]>`
    SELECT ROUND(SUM(total_amount) / NULLIF(COUNT(*), 0), 2)::numeric(14, 2)::text AS average
    FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid AND order_status <> 'CANCELLED'
      AND created_at >= ${bounds.gte} AND created_at < ${bounds.lt}`;
  return row?.average ?? null;
}

/** Each local day with orders or money: orders created, their value, and net money received. */
export async function salesByDay(
  tx: Tx,
  scope: TenantScope,
  bounds: Bounds,
  timeZone: string,
): Promise<SalesReport['byDay']> {
  const rows = await tx.$queryRaw<
    { date: string; orders: number; order_value: string; net: string }[]
  >`
    WITH o AS (
      SELECT (created_at AT TIME ZONE ${timeZone})::date AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(total_amount) FILTER (WHERE order_status <> 'CANCELLED'), 0) AS value
      FROM app.orders
      WHERE business_id = ${scope.businessId}::uuid
        AND created_at >= ${bounds.gte} AND created_at < ${bounds.lt}
      GROUP BY 1
    ), p AS (
      SELECT (occurred_at AT TIME ZONE ${timeZone})::date AS day,
        SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE -amount END) AS net
      FROM app.payments
      WHERE business_id = ${scope.businessId}::uuid
        AND occurred_at >= ${bounds.gte} AND occurred_at < ${bounds.lt}
      GROUP BY 1
    )
    SELECT to_char(COALESCE(o.day, p.day), 'YYYY-MM-DD') AS date,
      COALESCE(o.orders, 0)::int AS orders,
      COALESCE(o.value, 0)::numeric(14, 2)::text AS order_value,
      COALESCE(p.net, 0)::numeric(14, 2)::text AS net
    FROM o FULL OUTER JOIN p ON o.day = p.day
    ORDER BY 1`;
  return rows.map((row) => ({
    date: row.date,
    ordersCreated: row.orders,
    orderValue: row.order_value,
    netReceived: row.net,
  }));
}

/** Orders not cancelled, by source channel, largest order value first. */
export async function salesBySource(
  tx: Tx,
  scope: TenantScope,
  bounds: Bounds,
): Promise<SalesReport['bySource']> {
  const rows = await tx.$queryRaw<
    {
      source_channel: SalesReport['bySource'][number]['sourceChannel'];
      orders: number;
      order_value: string;
    }[]
  >`
    SELECT source_channel::text AS source_channel, COUNT(*)::int AS orders,
      SUM(total_amount)::numeric(14, 2)::text AS order_value
    FROM app.orders
    WHERE business_id = ${scope.businessId}::uuid AND order_status <> 'CANCELLED'
      AND created_at >= ${bounds.gte} AND created_at < ${bounds.lt}
    GROUP BY source_channel
    ORDER BY SUM(total_amount) DESC, source_channel`;
  return rows.map((row) => ({
    sourceChannel: row.source_channel,
    orders: row.orders,
    orderValue: row.order_value,
  }));
}

/**
 * The items with the largest value on orders not cancelled. A catalogue product counts as one item
 * even if it was renamed (shown by its latest name); custom items are grouped by name.
 */
export async function topItems(
  tx: Tx,
  scope: TenantScope,
  bounds: Bounds,
): Promise<SalesReport['topItems']> {
  return tx.$queryRaw<SalesReport['topItems']>`
    SELECT (array_agg(i.product_name_snapshot ORDER BY o.created_at DESC))[1] AS name,
      (array_agg(i.sku_snapshot ORDER BY o.created_at DESC))[1] AS sku,
      SUM(i.quantity)::int AS quantity,
      SUM(i.line_total)::numeric(14, 2)::text AS value
    FROM app.order_items i
    JOIN app.orders o ON o.business_id = i.business_id AND o.id = i.order_id
    WHERE i.business_id = ${scope.businessId}::uuid AND o.order_status <> 'CANCELLED'
      AND o.created_at >= ${bounds.gte} AND o.created_at < ${bounds.lt}
    GROUP BY COALESCE(i.product_id::text, 'custom:' || lower(i.product_name_snapshot))
    ORDER BY SUM(i.line_total) DESC, SUM(i.quantity) DESC, 1
    LIMIT ${TOP_ITEMS}`;
}
