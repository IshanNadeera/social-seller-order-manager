// The dashboard (docs/DEVELOPMENT.md §6.2; figures defined in §15). Four groups: today, what needs
// action, money right now, and the chosen period; then the newest orders. Order value, money
// received and COD still with couriers are separate tiles with their own labels and are never
// added together: a delivered COD order isn't money received until it is settled.
import type { DashboardSummary } from '@ssom/shared';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, buttonClass, linkClass } from '../../components/form';
import { formatDate, formatLocalDate, formatPercent } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessTimeZone } from '../account/use-business';
import { PaymentBadge, StageLabel } from '../orders/OrderBadges';
import { useDashboardSummary, useRecentOrders } from './api';
import { rangeProblem, readRange, todayIn } from './dashboard-range';
import type { DateRange } from './dashboard-range';
import { PeriodPicker } from './PeriodPicker';
import { Group, Tile } from './Tiles';

const s = strings.dashboard;
const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;
const OUT_FOR_DELIVERY_PATH = '/orders?deliveryStatus=DISPATCHED';
const COD_PATH = '/cod';

export function DashboardPage() {
  const timeZone = useBusinessTimeZone();
  const today = todayIn(timeZone);
  const [search, setSearch] = useSearchParams();
  const range = readRange(search, today);
  const problem = rangeProblem(range);
  const summary = useDashboardSummary(range, problem === null);

  const setRange = (next: DateRange) => {
    // Today is the default, so it needs nothing in the URL.
    setSearch(next.from === today && next.to === today ? {} : { from: next.from, to: next.to }, {
      replace: true,
    });
  };

  return (
    <section className="max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-slate-600">{s.todayIs(formatLocalDate(today))}</p>
      </header>

      <PeriodPicker range={range} today={today} problem={problem} onChange={setRange} />

      {problem !== null ? null : summary.data === undefined ? (
        summary.isError ? (
          <div className="space-y-3">
            <FormAlert tone="error">
              <p className="font-semibold">{s.loadFailed}</p>
              <ApiErrorMessage error={summary.error} />
            </FormAlert>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => void summary.refetch()}
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
        <Figures summary={summary.data} busy={summary.isFetching} />
      )}

      <RecentOrders />
    </section>
  );
}

function Figures({ summary, busy }: { summary: DashboardSummary; busy: boolean }) {
  const currency = useBusinessCurrency();
  const money = (amount: string) => formatMoney(amount, currency);
  const count = (value: number) => String(value);
  const t = s.tiles;
  const { today, now, period } = summary;

  return (
    <div className="space-y-6" aria-busy={busy || undefined}>
      <Group title={s.sections.today}>
        <Tile label={t.createdToday} value={count(today.ordersCreated)} />
      </Group>

      <Group title={s.sections.action}>
        <Tile
          label={t.needingAction}
          value={count(now.ordersNeedingAction)}
          hint={t.needingActionHint}
        />
        <Tile label={t.readyToSend} value={count(now.readyToSend)} />
        <Tile
          label={t.outForDelivery}
          value={count(now.outForDelivery)}
          to={OUT_FOR_DELIVERY_PATH}
        />
      </Group>

      <Group title={s.sections.money}>
        <Tile
          label={t.outstanding}
          value={money(now.outstandingBalance)}
          hint={t.outstandingHint}
        />
        <Tile
          label={t.codWithCourier}
          value={money(now.codWithCourier)}
          hint={t.codWithCourierHint}
          to={COD_PATH}
        />
        <Tile
          label={t.codOutForDelivery}
          value={money(now.codOutForDelivery)}
          hint={t.codOutForDeliveryHint}
        />
        <Tile label={t.refundsOwed} value={money(now.refundsOwed)} hint={t.refundsOwedHint} />
      </Group>

      <Group
        title={s.sections.period}
        note={s.period.showing(formatLocalDate(period.from), formatLocalDate(period.to))}
      >
        <Tile
          label={t.netReceived}
          value={money(period.netReceived)}
          hint={t.netReceivedHint(money(period.paymentsReceived), money(period.refunds))}
        />
        <Tile label={t.delivered} value={count(period.delivered)} />
        <Tile label={t.ordersCreated} value={count(period.ordersCreated)} />
        <Tile label={t.orderValue} value={money(period.orderValue)} hint={t.orderValueHint} />
        <Tile
          label={t.cancellationRate}
          value={
            period.cancellationRate === null
              ? t.noRate
              : t.cancellationRateValue(formatPercent(period.cancellationRate), period.cancelled)
          }
        />
      </Group>
    </div>
  );
}

/** The newest orders, each linking to its page (§6.2). */
function RecentOrders() {
  const recent = useRecentOrders();
  const currency = useBusinessCurrency();
  const timeZone = useBusinessTimeZone();
  const headingId = useId();
  const r = s.recent;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {s.sections.recent}
        </h2>
        <Link to="/orders" className={linkClass}>
          {r.all}
        </Link>
      </div>
      {recent.data === undefined ? (
        recent.isError ? (
          <div className="space-y-3">
            <FormAlert tone="error">
              <p className="font-semibold">{r.loadFailed}</p>
              <ApiErrorMessage error={recent.error} />
            </FormAlert>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => void recent.refetch()}
            >
              {strings.common.retry}
            </button>
          </div>
        ) : (
          <p className="text-slate-600">{strings.common.loading}</p>
        )
      ) : recent.data.items.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-slate-600">{r.empty}</p>
          <Link to="/orders/new" className={buttonClass.primary}>
            {r.newOrder}
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {recent.data.items.map((order) => (
            <li key={order.id}>
              <Link
                to={orderPath(order.id)}
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                <span className="space-y-1">
                  <span className="block font-semibold text-slate-900">{order.orderNumber}</span>
                  <span className="block text-sm text-slate-600">
                    {order.customerName} · {formatDate(order.createdAt, timeZone)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StageLabel stage={order.stage} />
                  <PaymentBadge status={order.paymentStatus} />
                  <span className="font-medium text-slate-900">
                    {formatMoney(order.totalAmount, currency)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
