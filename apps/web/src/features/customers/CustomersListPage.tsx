import type { CustomerSummary } from '@ssom/shared';
import { Link } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { CheckboxField, FormAlert, buttonClass, linkClass } from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { SearchBox } from '../../components/SearchBox';
import { formatDate } from '../../lib/format';
import { strings } from '../../lib/strings';
import { useListParams } from '../../lib/use-list-params';
import { useBusinessTimeZone } from '../account/use-business';
import { useCustomerList } from './api';
import type { CustomerListParams } from './api';
import { customerPaths } from './paths';

const s = strings.customers.list;

/** /customers (§6.6): search by name or phone, cards on mobile, a table on wider screens. */
export function CustomersListPage() {
  const [params, update] = useListParams();
  const list = useCustomerList(params);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <Link to={customerPaths.new} className={buttonClass.primary}>
          {s.add}
        </Link>
      </div>

      <SearchBox
        label={s.search}
        hint={s.searchHint}
        value={params.q}
        onSearch={(q) => update({ q }, { replace: true })}
      />
      <CheckboxField
        label={s.showArchived}
        checked={params.includeArchived}
        onChange={(event) => update({ includeArchived: event.target.checked }, { replace: true })}
      />

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
          <EmptyState params={params} onClear={() => update({ q: '' }, { replace: false })} />
        ) : (
          <>
            <CustomerCards customers={list.data.items} />
            <CustomerTable customers={list.data.items} />
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

function EmptyState({ params, onClear }: { params: CustomerListParams; onClear: () => void }) {
  if (params.q !== '') {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-slate-700">{s.noMatches(params.q)}</p>
        <button type="button" className={linkClass} onClick={onClear}>
          {s.clearSearch}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <h2 className="font-semibold">{s.emptyTitle}</h2>
      <p className="text-slate-600">{s.emptyBody}</p>
      <Link to={customerPaths.new} className={buttonClass.primary}>
        {s.add}
      </Link>
    </div>
  );
}

function ArchivedTag() {
  return (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
      {s.archived}
    </span>
  );
}

/** Mobile: one card per customer, the whole card is the link (§6.1: no wide tables on phones). */
function CustomerCards({ customers }: { customers: CustomerSummary[] }) {
  const timeZone = useBusinessTimeZone();
  return (
    <ul aria-label={s.listLabel} className="space-y-3 md:hidden">
      {customers.map((customer) => (
        <li key={customer.id}>
          <Link
            to={customerPaths.detail(customer.id)}
            className="block space-y-1 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{customer.name}</span>
              {customer.archivedAt !== null && <ArchivedTag />}
            </span>
            {customer.phone !== null && (
              <span className="block text-slate-700">{customer.phone}</span>
            )}
            <span className="block text-sm text-slate-600">{orderSummary(customer, timeZone)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function orderSummary(customer: CustomerSummary, timeZone: string): string {
  if (customer.lastOrderAt === null) return s.noOrders;
  return s.orderSummary(customer.orderCount, formatDate(customer.lastOrderAt, timeZone));
}

/** Wider screens: a table with the name as the link. */
function CustomerTable({ customers }: { customers: CustomerSummary[] }) {
  const timeZone = useBusinessTimeZone();
  const none = strings.common.none;
  return (
    <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
      <table aria-label={s.listLabel} className="w-full text-left">
        <thead className="border-b border-slate-200 bg-slate-50 text-sm text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              {s.columns.name}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {s.columns.phone}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              {s.columns.orders}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {s.columns.lastOrder}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {customers.map((customer) => (
            <tr key={customer.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Link to={customerPaths.detail(customer.id)} className={linkClass}>
                    {customer.name}
                  </Link>
                  {customer.archivedAt !== null && <ArchivedTag />}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-700">{customer.phone ?? none}</td>
              <td className="px-4 py-3 text-right text-slate-700">{customer.orderCount}</td>
              <td className="px-4 py-3 text-slate-700">
                {customer.lastOrderAt === null ? none : formatDate(customer.lastOrderAt, timeZone)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
