// The dashboard (docs/DEVELOPMENT.md §6.2, task E2), on the real routes and API client over a fake
// fetch. Fake data only.
import type { DashboardSummary, OrderSummary, Page } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';
import { addDays, todayIn } from './dashboard-range';

const s = strings.dashboard;
const t = s.tiles;
const TODAY = todayIn('Asia/Colombo');

function summary(from: string, to: string): DashboardSummary {
  return {
    timeZone: 'Asia/Colombo',
    today: { date: TODAY, ordersCreated: 3 },
    now: {
      ordersNeedingAction: 2,
      readyToSend: 4,
      outForDelivery: 1,
      outstandingBalance: '5450.00',
      codOutForDelivery: '1350.00',
      codWithCourier: '2700.00',
      refundsOwed: '300.00',
    },
    period: {
      from,
      to,
      ordersCreated: 8,
      cancelled: 1,
      cancellationRate: 0.125,
      delivered: 2,
      orderValue: '7700.00',
      paymentsReceived: '2650.00',
      refunds: '100.00',
      netReceived: '2550.00',
    },
  };
}

const recent: OrderSummary = {
  id: '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f',
  orderNumber: 'NIM-0042',
  createdAt: '2026-11-01T06:00:00.000Z',
  customerName: 'Kamala Perera',
  customerPhoneMasked: '077 ••• 4567',
  totalAmount: '2450.00',
  balanceDue: '2450.00',
  stage: 'NEW',
  orderStatus: 'NEW',
  paymentStatus: 'UNPAID',
  sourceChannel: 'WHATSAPP',
} as OrderSummary;

function setup(
  path = '/',
  orders: OrderSummary[] = [recent],
  configure: (api: FakeApi) => void = () => {},
) {
  const api = createFakeApi();
  api.on('GET', '/dashboard/summary', (call) => {
    const query = new URLSearchParams(call.path.split('?')[1]);
    return { status: 200, body: summary(query.get('from') ?? '', query.get('to') ?? '') };
  });
  api.on('GET', '/orders', () => ({
    status: 200,
    body: {
      items: orders,
      page: 1,
      pageSize: 5,
      total: orders.length,
    } satisfies Page<OrderSummary>,
  }));
  configure(api);
  const router = renderApp(path, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const summaryCalls = (api: FakeApi) =>
  api.calls.filter((call) => call.path.startsWith('/dashboard/summary')).map((call) => call.path);
const group = (name: string) => within(screen.getByRole('region', { name }));
/** The value shown under a tile's label. */
const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('dashboard figures (§6.2)', () => {
  it('shows every §6.2 figure, each money figure on its own tile', async () => {
    const { api } = setup();
    expect(await screen.findByRole('heading', { level: 1, name: s.title })).toBeInTheDocument();
    await screen.findByText(t.createdToday);
    expect(summaryCalls(api)).toEqual([`/dashboard/summary?from=${TODAY}&to=${TODAY}`]);

    expect(tile(t.createdToday)).toHaveTextContent('3');
    expect(tile(t.needingAction)).toHaveTextContent('2');
    expect(tile(t.readyToSend)).toHaveTextContent('4');
    expect(tile(t.outForDelivery)).toHaveTextContent('1');
    expect(tile(t.delivered)).toHaveTextContent('2');
    expect(tile(t.outstanding)).toHaveTextContent('LKR 5,450.00');
    expect(tile(t.refundsOwed)).toHaveTextContent('LKR 300.00');
    expect(tile(t.cancellationRate)).toHaveTextContent('12.5% (1)');
    // Money received, order value and COD with couriers: three separate figures, never one.
    expect(tile(t.netReceived)).toHaveTextContent('LKR 2,550.00');
    expect(screen.getByText(t.netReceivedHint('LKR 2,650.00', 'LKR 100.00'))).toBeInTheDocument();
    expect(tile(t.orderValue)).toHaveTextContent('LKR 7,700.00');
    expect(tile(t.codWithCourier)).toHaveTextContent('LKR 2,700.00');
    expect(tile(t.codOutForDelivery)).toHaveTextContent('LKR 1,350.00');
    expect(group(s.sections.money).queryByText(t.netReceived)).not.toBeInTheDocument();
  });

  it('links COD with couriers to settling it, and out for delivery to those orders', async () => {
    setup();
    await screen.findByText(t.codWithCourier);
    expect(screen.getByRole('link', { name: t.open(t.codWithCourier) })).toHaveAttribute(
      'href',
      '/cod',
    );
    expect(screen.getByRole('link', { name: t.open(t.outForDelivery) })).toHaveAttribute(
      'href',
      '/orders?deliveryStatus=DISPATCHED',
    );
  });

  it('a failed load can be retried', async () => {
    // Down until the seller presses Retry (a 5xx is retried once on its own first, after 1 s).
    let down = true;
    setup('/', [recent], (api) =>
      api.on('GET', '/dashboard/summary', () =>
        down
          ? errorReply(503, 'UNAVAILABLE', 'Try again.')
          : { status: 200, body: summary(TODAY, TODAY) },
      ),
    );
    expect(await screen.findByText(s.loadFailed, {}, { timeout: 4000 })).toBeInTheDocument();
    down = false;
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));
    expect(await screen.findByText(t.createdToday)).toBeInTheDocument();
  });
});

describe('recent orders failing (§2.2)', () => {
  it('says so and can be tried again', async () => {
    let down = true;
    setup('/', [recent], (api) =>
      api.on('GET', '/orders', () =>
        down
          ? errorReply(503, 'UNAVAILABLE', 'Try again.')
          : { status: 200, body: { items: [recent], page: 1, pageSize: 5, total: 1 } },
      ),
    );
    const section = within(await screen.findByRole('region', { name: s.sections.recent }));
    expect(
      await section.findByText(s.recent.loadFailed, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    down = false;
    await userEvent.click(section.getByRole('button', { name: strings.common.retry }));
    expect(await section.findByRole('link', { name: /NIM-0042/ })).toBeInTheDocument();
  });
});

describe('the period picker (§6.2)', () => {
  it('a preset asks for its dates and keeps them in the URL', async () => {
    const { api, router } = setup();
    await screen.findByText(t.createdToday);
    await userEvent.selectOptions(screen.getByLabelText(s.period.preset), s.period.presets.last7);
    const from = addDays(TODAY, -6);
    await waitFor(() =>
      expect(summaryCalls(api)).toContain(`/dashboard/summary?from=${from}&to=${TODAY}`),
    );
    expect(router.state.location.search).toBe(`?from=${from}&to=${TODAY}`);
  });

  it('opens on the period in the URL, with its dates to edit', async () => {
    const { api } = setup('/?from=2026-10-01&to=2026-10-31');
    await screen.findByText(t.createdToday);
    expect(summaryCalls(api)).toEqual(['/dashboard/summary?from=2026-10-01&to=2026-10-31']);
    expect(screen.getByLabelText(s.period.preset)).toHaveValue('custom');
    expect(screen.getByLabelText(s.period.from)).toHaveValue('2026-10-01');
    expect(screen.getByText(s.period.showing('1 Oct 2026', '31 Oct 2026'))).toBeInTheDocument();
  });

  it('a range that ends before it starts is explained, and not asked for', async () => {
    const { api } = setup('/?from=2026-10-31&to=2026-10-01');
    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(summaryCalls(api)).toEqual([]);
  });
});

describe('recent orders (§6.2)', () => {
  it('lists the newest orders, each linking to its page', async () => {
    const { api } = setup();
    const list = within(await screen.findByRole('region', { name: s.sections.recent }));
    const link = await list.findByRole('link', { name: /NIM-0042/ });
    expect(link).toHaveAttribute('href', `/orders/${recent.id}`);
    expect(link).toHaveTextContent('Kamala Perera');
    expect(api.calls.some((call) => call.path === '/orders?page=1&pageSize=5')).toBe(true);
  });

  it('a business with no orders gets a way to make one', async () => {
    setup('/', []);
    expect(await screen.findByText(s.recent.empty)).toBeInTheDocument();
    // The page's own link (the app shell has "New order" links too).
    const recentOrders = within(screen.getByRole('region', { name: s.sections.recent }));
    expect(recentOrders.getByRole('link', { name: s.recent.newOrder })).toHaveAttribute(
      'href',
      '/orders/new',
    );
  });
});
