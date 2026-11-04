// A customer's order history on their page (docs/DEVELOPMENT.md §6.6, §9.2): newest first, in pages,
// each order linking to its details.
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, buttonClass, linkClass } from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { formatDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessTimeZone } from '../account/use-business';
import { useCustomerOrders } from '../orders/api';
import { PaymentBadge, StageLabel } from '../orders/OrderBadges';

const h = strings.customers.history;
const list = strings.orders.list;

export function CustomerOrders({ customerId }: { customerId: string }) {
  const headingId = useId();
  const [page, setPage] = useState(1);
  const orders = useCustomerOrders(customerId, page);
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {h.title}
      </h2>
      {orders.data === undefined ? (
        orders.isError ? (
          <div className="space-y-3">
            <FormAlert tone="error">
              <p className="font-semibold">{h.loadFailed}</p>
              <ApiErrorMessage error={orders.error} />
            </FormAlert>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => void orders.refetch()}
            >
              {strings.common.retry}
            </button>
          </div>
        ) : (
          <p role="status" className="text-slate-600">
            {strings.common.loading}
          </p>
        )
      ) : orders.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-slate-600">
          {h.empty}
        </p>
      ) : (
        <div className="space-y-3" aria-busy={orders.isFetching || undefined}>
          <ul
            aria-label={h.listLabel}
            className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
          >
            {orders.data.items.map((order) => (
              <li key={order.id} className="space-y-1 px-4 py-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link to={`/orders/${encodeURIComponent(order.id)}`} className={linkClass}>
                    {order.orderNumber}
                  </Link>
                  <span className="text-sm text-slate-600">
                    {formatDate(order.createdAt, timeZone)}
                  </span>
                </p>
                <p className="flex flex-wrap items-center gap-2">
                  <StageLabel stage={order.stage} />
                  <PaymentBadge status={order.paymentStatus} />
                </p>
                <p className="flex flex-wrap justify-between gap-2 text-sm text-slate-700">
                  <span>{list.total(formatMoney(order.totalAmount, currency))}</span>
                  <span>{list.balance(formatMoney(order.balanceDue, currency))}</span>
                </p>
              </li>
            ))}
          </ul>
          <Pagination
            page={orders.data.page}
            pageSize={orders.data.pageSize}
            total={orders.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </section>
  );
}
