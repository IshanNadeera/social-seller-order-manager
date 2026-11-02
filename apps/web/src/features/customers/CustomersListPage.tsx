import type { CustomerSummary } from '@ssom/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { CheckboxField, FormAlert, TextField, buttonClass, linkClass } from '../../components/form';
import { Pagination } from '../../components/Pagination';
import { formatDate } from '../../lib/format';
import { strings } from '../../lib/strings';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useBusinessTimeZone, useCustomerList } from './api';
import type { CustomerListParams } from './api';
import { customerPaths } from './paths';

const s = strings.customers.list;

/** How long typing must pause before the list is searched (slow networks: fewer requests). */
export const SEARCH_DELAY_MS = 300;

/** The list's state lives in the URL (?q=&page=&archived=1), so Back and refresh keep it. */
function readParams(searchParams: URLSearchParams): CustomerListParams {
  const page = Number(searchParams.get('page'));
  return {
    q: searchParams.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    includeArchived: searchParams.get('archived') === '1',
  };
}

/** /customers (§6.6): search by name or phone, cards on mobile, a table on wider screens. */
export function CustomersListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = readParams(searchParams);
  const list = useCustomerList(params);

  /** Changes some of q / page / archived; a new search or filter starts again at page 1. */
  const update = (changes: Partial<CustomerListParams>, options: { replace: boolean }) => {
    setSearchParams((current) => {
      const next = { ...readParams(current), page: 1, ...changes };
      const query = new URLSearchParams();
      if (next.q !== '') query.set('q', next.q);
      if (next.page > 1) query.set('page', String(next.page));
      if (next.includeArchived) query.set('archived', '1');
      return query;
    }, options);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <Link to={customerPaths.new} className={buttonClass.primary}>
          {s.add}
        </Link>
      </div>

      <SearchBox value={params.q} onSearch={(q) => update({ q }, { replace: true })} />
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

/**
 * Searches as the seller types, once typing pauses; Enter searches at once. Follows the URL when it
 * changes from outside (Back, "Clear search").
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  // The last search this box asked for, so the URL and the box don't fight.
  const lastSearched = useRef(value);
  // Act only when the settled text really changes, not on every render: after Back, the old
  // settled text must not be pushed into the URL again.
  const previousDebounced = useRef(debounced);

  useEffect(() => {
    if (value === lastSearched.current) return;
    lastSearched.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    if (debounced === previousDebounced.current) return;
    previousDebounced.current = debounced;
    if (debounced === lastSearched.current) return;
    lastSearched.current = debounced;
    onSearch(debounced);
  }, [debounced, onSearch]);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = text.trim();
        if (q === lastSearched.current) return;
        lastSearched.current = q;
        onSearch(q);
      }}
    >
      <TextField
        label={s.search}
        hint={s.searchHint}
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </form>
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
