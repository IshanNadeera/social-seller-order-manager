// The sales report screen (docs/DEVELOPMENT.md §9.4, §2.2, task E3), on the real routes and API
// client over a fake fetch. Fake data only.
import type { SalesReport } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';
import { presetRange, todayIn } from '../dashboard/dashboard-range';

const r = strings.reports;
const TODAY = todayIn('Asia/Colombo');
const MONTH = presetRange('thisMonth', TODAY);

function sales(from: string, to: string, empty = false): SalesReport {
  return {
    timeZone: 'Asia/Colombo',
    from,
    to,
    totals: {
      ordersCreated: empty ? 0 : 4,
      cancelled: empty ? 0 : 1,
      orderValue: empty ? '0.00' : '3250.00',
      averageOrderValue: empty ? null : '1083.33',
      paymentsReceived: empty ? '0.00' : '500.00',
      refunds: empty ? '0.00' : '100.00',
      netReceived: empty ? '0.00' : '400.00',
    },
    byDay: empty
      ? []
      : [
          { date: '2026-10-10', ordersCreated: 2, orderValue: '2000.00', netReceived: '500.00' },
          { date: '2026-10-12', ordersCreated: 0, orderValue: '0.00', netReceived: '-100.00' },
        ],
    bySource: empty ? [] : [{ sourceChannel: 'WHATSAPP', orders: 1, orderValue: '2000.00' }],
    topItems: empty ? [] : [{ name: 'Silk Saree', sku: 'SS-1', quantity: 3, value: '3000.00' }],
  };
}

function setup(path = '/reports', configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  api.on('GET', '/reports/sales', (call) => {
    const query = new URLSearchParams(call.path.split('?')[1]);
    const from = query.get('from') ?? '';
    return { status: 200, body: sales(from, query.get('to') ?? '', from.startsWith('2026-09')) };
  });
  configure(api);
  const router = renderApp(path, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const reportCalls = (api: FakeApi) =>
  api.calls.filter((call) => call.path.startsWith('/reports/sales')).map((call) => call.path);
const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('sales report (§9.4)', () => {
  it('opens on this month, with totals that keep order value and money apart', async () => {
    const { api } = setup();
    expect(await screen.findByRole('heading', { level: 1, name: r.title })).toBeInTheDocument();
    await screen.findByText(r.totals.ordersCreated);
    expect(reportCalls(api)).toEqual([`/reports/sales?from=${MONTH.from}&to=${MONTH.to}`]);
    expect(tile(r.totals.ordersCreated)).toHaveTextContent('4');
    expect(screen.getByText(r.totals.cancelledHint(1))).toBeInTheDocument();
    expect(tile(r.totals.orderValue)).toHaveTextContent('LKR 3,250.00');
    expect(tile(r.totals.averageOrderValue)).toHaveTextContent('LKR 1,083.33');
    expect(tile(r.totals.netReceived)).toHaveTextContent('LKR 400.00');
    expect(
      screen.getByText(r.totals.netReceivedHint('LKR 500.00', 'LKR 100.00')),
    ).toBeInTheDocument();
  });

  it('shows the days, sources and top items', async () => {
    setup();
    const days = within(await screen.findByRole('table', { name: r.byDay.title }));
    const rows = days.getAllByRole('row');
    expect(rows).toHaveLength(3); // the header and two days
    expect(rows[1]).toHaveTextContent('10 Oct 2026');
    expect(rows[2]).toHaveTextContent('-LKR 100.00');
    const sources = within(screen.getByRole('list', { name: r.bySource.title }));
    expect(sources.getByText(strings.sourceChannel.WHATSAPP)).toBeInTheDocument();
    expect(sources.getByText(r.bySource.orders(1))).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: r.topItems.title }));
    expect(items.getByText('Silk Saree')).toBeInTheDocument();
    expect(
      items.getByText(`${r.topItems.quantity(3)} · ${r.topItems.sku('SS-1')}`),
    ).toBeInTheDocument();
  });

  it('a period with nothing in it says so', async () => {
    setup('/reports?from=2026-09-01&to=2026-09-30');
    expect(await screen.findByText(r.byDay.empty)).toBeInTheDocument();
    expect(screen.getByText(r.bySource.empty)).toBeInTheDocument();
    expect(screen.getByText(r.topItems.empty)).toBeInTheDocument();
    expect(tile(r.totals.averageOrderValue)).toHaveTextContent(r.totals.noAverage);
  });

  it('another period is asked for and kept in the URL; a backwards range is not asked for', async () => {
    const { api, router } = setup();
    await screen.findByText(r.totals.ordersCreated);
    await userEvent.selectOptions(
      screen.getByLabelText(strings.dashboard.period.preset),
      strings.dashboard.period.presets.today,
    );
    await waitFor(() =>
      expect(reportCalls(api)).toContain(`/reports/sales?from=${TODAY}&to=${TODAY}`),
    );
    // On the 1st, today is this month, the default, which needs nothing in the URL.
    expect(router.state.location.search).toBe(
      TODAY === MONTH.from ? '' : `?from=${TODAY}&to=${TODAY}`,
    );

    const before = reportCalls(api).length;
    await router.navigate('/reports?from=2026-10-31&to=2026-10-01');
    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(reportCalls(api)).toHaveLength(before);
  });

  it('a failed load can be retried', async () => {
    let down = true;
    setup('/reports', (api) =>
      api.on('GET', '/reports/sales', () =>
        down
          ? errorReply(503, 'UNAVAILABLE', 'Try again.')
          : { status: 200, body: sales(MONTH.from, MONTH.to) },
      ),
    );
    // A 5xx is retried once on its own first, after 1 s.
    expect(await screen.findByText(r.loadFailed, {}, { timeout: 4000 })).toBeInTheDocument();
    down = false;
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));
    expect(await screen.findByText(r.totals.ordersCreated)).toBeInTheDocument();
  });
});
