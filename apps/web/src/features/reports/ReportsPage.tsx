// /reports: the sales report (docs/DEVELOPMENT.md §9.4, §2.2; figures as defined in §15). Totals,
// then by day, by source and the top items, for a period kept in the URL (default: this month).
// Order value and money received are separate figures, as on the dashboard.
import type { SalesReport } from '@ssom/shared';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, buttonClass } from '../../components/form';
import { formatLocalDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessTimeZone } from '../account/use-business';
import { presetRange, rangeProblem, readRange, todayIn } from '../dashboard/dashboard-range';
import type { DateRange } from '../dashboard/dashboard-range';
import { PeriodPicker } from '../dashboard/PeriodPicker';
import { Group, Tile } from '../dashboard/Tiles';
import { useSalesReport } from './api';

const r = strings.reports;

export function ReportsPage() {
  const timeZone = useBusinessTimeZone();
  const today = todayIn(timeZone);
  const thisMonth = presetRange('thisMonth', today);
  const [search, setSearch] = useSearchParams();
  const range = readRange(search, today, thisMonth);
  const problem = rangeProblem(range);
  const report = useSalesReport(range, problem === null);

  const setRange = (next: DateRange) => {
    // This month is the default, so it needs nothing in the URL.
    const isDefault = next.from === thisMonth.from && next.to === thisMonth.to;
    setSearch(isDefault ? {} : { from: next.from, to: next.to }, { replace: true });
  };

  return (
    <section className="max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{r.title}</h1>
        <p className="text-slate-600">{r.intro}</p>
      </header>

      <PeriodPicker range={range} today={today} problem={problem} onChange={setRange} />

      {problem !== null ? null : report.data === undefined ? (
        report.isError ? (
          <div className="space-y-3">
            <FormAlert tone="error">
              <p className="font-semibold">{r.loadFailed}</p>
              <ApiErrorMessage error={report.error} />
            </FormAlert>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => void report.refetch()}
            >
              {strings.common.retry}
            </button>
          </div>
        ) : (
          <p role="status" className="text-slate-600">
            {strings.common.loading}
          </p>
        )
      ) : (
        <Sales report={report.data} busy={report.isFetching} />
      )}
    </section>
  );
}

/** A titled part of the report. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-slate-600">
    {children}
  </p>
);

function Sales({ report, busy }: { report: SalesReport; busy: boolean }) {
  const currency = useBusinessCurrency();
  const money = (amount: string) => formatMoney(amount, currency);
  const { totals } = report;
  const t = r.totals;
  const cell = 'px-3 py-2';

  return (
    <div className="space-y-6" aria-busy={busy || undefined}>
      <Group
        title={r.sales}
        note={strings.dashboard.period.showing(
          formatLocalDate(report.from),
          formatLocalDate(report.to),
        )}
      >
        <Tile
          label={t.ordersCreated}
          value={String(totals.ordersCreated)}
          hint={t.cancelledHint(totals.cancelled)}
        />
        <Tile label={t.orderValue} value={money(totals.orderValue)} hint={t.orderValueHint} />
        <Tile
          label={t.averageOrderValue}
          value={totals.averageOrderValue === null ? t.noAverage : money(totals.averageOrderValue)}
        />
        <Tile
          label={t.netReceived}
          value={money(totals.netReceived)}
          hint={t.netReceivedHint(money(totals.paymentsReceived), money(totals.refunds))}
        />
      </Group>

      <Part title={r.byDay.title}>
        {report.byDay.length === 0 ? (
          <Empty>{r.byDay.empty}</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table aria-label={r.byDay.title} className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className={cell}>
                    {r.byDay.date}
                  </th>
                  <th scope="col" className={`${cell} text-right`}>
                    {r.byDay.orders}
                  </th>
                  <th scope="col" className={`${cell} text-right`}>
                    {r.byDay.orderValue}
                  </th>
                  <th scope="col" className={`${cell} text-right`}>
                    {r.byDay.netReceived}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.byDay.map((day) => (
                  <tr key={day.date}>
                    <th scope="row" className={`${cell} font-normal`}>
                      {formatLocalDate(day.date)}
                    </th>
                    <td className={`${cell} text-right`}>{day.ordersCreated}</td>
                    <td className={`${cell} text-right`}>{money(day.orderValue)}</td>
                    <td className={`${cell} text-right`}>{money(day.netReceived)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Part>

      <div className="grid gap-6 md:grid-cols-2">
        <Part title={r.bySource.title}>
          {report.bySource.length === 0 ? (
            <Empty>{r.bySource.empty}</Empty>
          ) : (
            <ul
              aria-label={r.bySource.title}
              className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
            >
              {report.bySource.map((row) => (
                <li key={row.sourceChannel} className="flex flex-wrap justify-between gap-2 p-3">
                  <span>
                    <span className="block font-medium">
                      {strings.sourceChannel[row.sourceChannel]}
                    </span>
                    <span className="block text-sm text-slate-600">
                      {r.bySource.orders(row.orders)}
                    </span>
                  </span>
                  <span className="font-medium">{money(row.orderValue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Part>

        <Part title={r.topItems.title}>
          {report.topItems.length === 0 ? (
            <Empty>{r.topItems.empty}</Empty>
          ) : (
            <ol
              aria-label={r.topItems.title}
              className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
            >
              {report.topItems.map((item) => (
                <li
                  key={`${item.name}|${item.sku ?? ''}`}
                  className="flex flex-wrap justify-between gap-2 p-3"
                >
                  <span>
                    <span className="block font-medium">{item.name}</span>
                    <span className="block text-sm text-slate-600">
                      {r.topItems.quantity(item.quantity)}
                      {item.sku !== null && ` · ${r.topItems.sku(item.sku)}`}
                    </span>
                  </span>
                  <span className="font-medium">{money(item.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </Part>
      </div>
    </div>
  );
}
