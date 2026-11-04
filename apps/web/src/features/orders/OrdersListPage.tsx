import { DELIVERY_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, SOURCE_CHANNELS } from '@ssom/shared';
import type {
  DeliveryStatus,
  OrderStatus,
  OrderSummary,
  PaymentStatus,
  SourceChannel,
} from '@ssom/shared';
import { Link } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, SelectField, TextField, buttonClass, linkClass } from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { SearchBox } from '../../components/SearchBox';
import { formatDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessTimeZone } from '../account/use-business';
import { useOrderList } from './api';
import { PaymentBadge, StageLabel } from './OrderBadges';
import { hasOrderFilters, useOrderListParams } from './order-list-params';
import type { OrderListParams } from './order-list-params';

const s = strings.orders.list;
const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;
const NEW_ORDER_PATH = '/orders/new';

/**
 * /orders (docs/DEVELOPMENT.md §6.3): search, filters, server-side pages (newest first), cards on
 * phones and a table on wider screens. Search, filters and page live in the URL.
 */
export function OrdersListPage() {
  const [params, update] = useOrderListParams();
  const list = useOrderList(params);
  const filtered = params.q !== '' || hasOrderFilters(params);
  const clearAll = () =>
    update(
      {
        q: '',
        orderStatus: null,
        paymentStatus: null,
        deliveryStatus: null,
        sourceChannel: null,
        from: null,
        to: null,
      },
      { replace: false },
    );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <Link to={NEW_ORDER_PATH} className={buttonClass.primary}>
          {s.add}
        </Link>
      </div>

      <SearchBox
        label={s.search}
        hint={s.searchHint}
        value={params.q}
        onSearch={(q) => update({ q }, { replace: true })}
      />
      <Filters params={params} update={update} />
      {filtered && (
        <button type="button" className={buttonClass.secondary} onClick={clearAll}>
          {s.clearFilters}
        </button>
      )}

      <div aria-busy={list.isFetching || undefined} className="space-y-4">
        {list.data === undefined ? (
          list.isError ? (
            <div className="space-y-3">
              <FormAlert tone="error">
                <p className="font-semibold">{s.loadFailed}</p>
                <ApiErrorMessage error={list.error} />
              </FormAlert>
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => void list.refetch()}
              >
                {strings.common.retry}
              </button>
            </div>
          ) : (
            <p role="status" className="text-slate-600">
              {strings.common.loading}
            </p>
          )
        ) : list.data.items.length === 0 ? (
          <EmptyState filtered={filtered} onClear={clearAll} />
        ) : (
          <>
            <OrderCards orders={list.data.items} />
            <OrderTable orders={list.data.items} />
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={(page) => update({ ...params, page }, { replace: false })}
            />
          </>
        )}
      </div>
    </section>
  );
}

type Update = (changes: Partial<OrderListParams>, options: { replace: boolean }) => void;

/** The §6.3 filters. Each change starts again at page 1. */
function Filters({ params, update }: { params: OrderListParams; update: Update }) {
  const set = (changes: Partial<OrderListParams>) => update(changes, { replace: true });
  const orNull = <T extends string>(value: string) => (value === '' ? null : (value as T));
  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <legend className="px-1 font-semibold">{s.filters}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label={s.orderStatus}
          value={params.orderStatus ?? ''}
          onChange={(event) => set({ orderStatus: orNull<OrderStatus>(event.target.value) })}
        >
          <option value="">{s.any}</option>
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {strings.orderStatus[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={s.paymentStatus}
          value={params.paymentStatus ?? ''}
          onChange={(event) => set({ paymentStatus: orNull<PaymentStatus>(event.target.value) })}
        >
          <option value="">{s.any}</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {strings.paymentStatus[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={s.deliveryStatus}
          value={params.deliveryStatus ?? ''}
          onChange={(event) => set({ deliveryStatus: orNull<DeliveryStatus>(event.target.value) })}
        >
          <option value="">{s.any}</option>
          {DELIVERY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {strings.deliveryStatus[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={s.sourceChannel}
          value={params.sourceChannel ?? ''}
          onChange={(event) => set({ sourceChannel: orNull<SourceChannel>(event.target.value) })}
        >
          <option value="">{s.any}</option>
          {SOURCE_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {strings.sourceChannel[channel]}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={s.from}
          hint={s.dateHint}
          type="date"
          value={params.from ?? ''}
          max={params.to ?? undefined}
          onChange={(event) => set({ from: orNull(event.target.value) })}
        />
        <TextField
          label={s.to}
          type="date"
          value={params.to ?? ''}
          min={params.from ?? undefined}
          onChange={(event) => set({ to: orNull(event.target.value) })}
        />
      </div>
    </fieldset>
  );
}

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-slate-700">{s.noMatches}</p>
        <button type="button" className={linkClass} onClick={onClear}>
          {s.clearFilters}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <h2 className="font-semibold">{s.emptyTitle}</h2>
      <p className="text-slate-600">{s.emptyBody}</p>
      <Link to={NEW_ORDER_PATH} className={buttonClass.primary}>
        {s.add}
      </Link>
    </div>
  );
}

/** Mobile: one card per order; the whole card is the link (§6.1: no wide tables on phones). */
function OrderCards({ orders }: { orders: OrderSummary[] }) {
  const timeZone = useBusinessTimeZone();
  const currency = useBusinessCurrency();
  return (
    <ul aria-label={s.listLabel} className="space-y-3 md:hidden">
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            to={orderPath(order.id)}
            className="block space-y-2 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-900">{order.orderNumber}</span>
              <span className="text-sm text-slate-600">
                {formatDate(order.createdAt, timeZone)}
              </span>
            </span>
            <span className="block text-slate-800">
              {order.customerName}
              {order.customerPhoneMasked !== null && (
                <span className="text-slate-600"> · {order.customerPhoneMasked}</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <StageLabel stage={order.stage} />
              <PaymentBadge status={order.paymentStatus} />
            </span>
            <span className="flex flex-wrap justify-between gap-2 text-sm text-slate-700">
              <span>{s.total(formatMoney(order.totalAmount, currency))}</span>
              <span>{s.balance(formatMoney(order.balanceDue, currency))}</span>
            </span>
            <span className="block text-xs text-slate-500">
              {s.source(strings.sourceChannel[order.sourceChannel])}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Wider screens: a table with the order number as the link. */
function OrderTable({ orders }: { orders: OrderSummary[] }) {
  const timeZone = useBusinessTimeZone();
  const currency = useBusinessCurrency();
  const head = 'px-4 py-2 font-medium';
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
      <table aria-label={s.listLabel} className="w-full text-left">
        <thead className="border-b border-slate-200 bg-slate-50 text-sm text-slate-600">
          <tr>
            <th scope="col" className={head}>
              {s.columns.order}
            </th>
            <th scope="col" className={head}>
              {s.columns.date}
            </th>
            <th scope="col" className={head}>
              {s.columns.customer}
            </th>
            <th scope="col" className={head}>
              {s.columns.stage}
            </th>
            <th scope="col" className={head}>
              {s.columns.payment}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {s.columns.total}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {s.columns.balance}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link to={orderPath(order.id)} className={linkClass}>
                  {order.orderNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-700">{formatDate(order.createdAt, timeZone)}</td>
              <td className="px-4 py-3">
                <span className="block text-slate-900">{order.customerName}</span>
                {order.customerPhoneMasked !== null && (
                  <span className="block text-sm text-slate-600">{order.customerPhoneMasked}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <StageLabel stage={order.stage} />
              </td>
              <td className="px-4 py-3">
                <PaymentBadge status={order.paymentStatus} />
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {formatMoney(order.totalAmount, currency)}
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {formatMoney(order.balanceDue, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
