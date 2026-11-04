// Orders list (docs/DEVELOPMENT.md §6.3, task C14), on the real routes and API client over a fake
// fetch, so each test checks exactly what the app asks for. Fake data only.
import type { OrderSummary, Page } from '@ssom/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.orders.list;
const ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';

function order(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: ID,
    orderNumber: 'NIM-0042',
    createdAt: '2026-11-01T06:00:00.000Z',
    customerName: 'Nimali Demo',
    customerPhoneMasked: '077 ••• 4567',
    totalAmount: '3450.00',
    balanceDue: '2450.00',
    stage: 'OUT_FOR_DELIVERY',
    orderStatus: 'READY',
    paymentStatus: 'PARTIALLY_PAID',
    deliveryStatus: 'DISPATCHED',
    sourceChannel: 'WHATSAPP',
    fulfilmentType: 'DELIVERY',
    ...overrides,
  };
}

const page = (items: OrderSummary[], overrides: Partial<Page<OrderSummary>> = {}) => ({
  status: 200,
  body: { items, page: 1, pageSize: 25, total: items.length, ...overrides },
});

function setup(path: string, configure: (api: FakeApi) => void) {
  const api = createFakeApi();
  configure(api);
  const router = renderApp(path, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const orderRequests = (api: FakeApi) =>
  api.calls.filter((call) => call.method === 'GET' && call.path.startsWith('/orders'));
const lastPath = (api: FakeApi) => orderRequests(api).at(-1)?.path;

describe('orders list (§6.3)', () => {
  it('shows cards (mobile) and a table (desktop): number, date, customer with a masked phone, stage, payment, money', async () => {
    setup('/orders', (api) => api.on('GET', '/orders', () => page([order()])));
    const cards = await screen.findByRole('list', { name: s.listLabel });
    const card = within(cards).getByRole('link', { name: /NIM-0042/ });
    expect(card).toHaveAttribute('href', `/orders/${ID}`);
    for (const text of [
      '1 Nov 2026',
      'Nimali Demo',
      '077 ••• 4567',
      strings.orderStage.OUT_FOR_DELIVERY,
      strings.paymentStatus.PARTIALLY_PAID,
      s.total('LKR 3,450.00'),
      s.balance('LKR 2,450.00'),
    ]) {
      expect(card).toHaveTextContent(text);
    }

    const row = within(screen.getByRole('table', { name: s.listLabel })).getByRole('row', {
      name: /NIM-0042/,
    });
    for (const text of ['077 ••• 4567', strings.orderStage.OUT_FOR_DELIVERY, 'LKR 2,450.00']) {
      expect(row).toHaveTextContent(text);
    }
    expect(within(row).getByRole('link', { name: 'NIM-0042' })).toHaveAttribute('href', `/orders/${ID}`);
  });

  it('filters by status, payment, delivery, source and dates, in the URL and the request; clears them', async () => {
    const { api, router } = setup('/orders', (api) => api.on('GET', '/orders', () => page([order()])));
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: s.clearFilters })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(s.orderStatus), 'READY');
    await userEvent.selectOptions(screen.getByLabelText(s.deliveryStatus), 'DISPATCHED');
    await userEvent.selectOptions(screen.getByLabelText(s.sourceChannel), 'WHATSAPP');
    await userEvent.selectOptions(screen.getByLabelText(s.paymentStatus), 'UNPAID');
    // Date inputs are set whole, as the browser's date picker does.
    fireEvent.change(screen.getByLabelText(s.from), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText(s.to), { target: { value: '2026-10-31' } });
    const expected =
      'orderStatus=READY&paymentStatus=UNPAID&deliveryStatus=DISPATCHED&sourceChannel=WHATSAPP&from=2026-10-01&to=2026-10-31';
    await waitFor(() => expect(lastPath(api)).toBe(`/orders?${expected}`));
    expect(router.state.location.search).toBe(`?${expected}`);

    await userEvent.click(screen.getByRole('button', { name: s.clearFilters }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByLabelText(s.from)).toHaveValue('');
    expect(await screen.findByRole('link', { name: 'NIM-0042' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: s.clearFilters })).not.toBeInTheDocument();
    expect(screen.getByLabelText(s.orderStatus)).toHaveValue('');
  });

  it('searches by number, name or phone once typing pauses', async () => {
    const { api, router } = setup('/orders', (api) => api.on('GET', '/orders', () => page([order()])));
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: s.search }), 'nim-0042');
    await waitFor(() => expect(lastPath(api)).toBe('/orders?q=nim-0042'));
    expect(router.state.location.search).toBe('?q=nim-0042');
  });

  it('opens a link with filters already set, and pages through the results', async () => {
    const { api, router } = setup('/orders?paymentStatus=UNPAID', (api) =>
      api.on('GET', '/orders', (call) =>
        page([order({ orderNumber: call.path.includes('page=2') ? 'NIM-0017' : 'NIM-0042' })], {
          total: 30,
          page: call.path.includes('page=2') ? 2 : 1,
        }),
      ),
    );
    await screen.findByRole('table');
    expect(lastPath(api)).toBe('/orders?paymentStatus=UNPAID');
    expect(screen.getByLabelText(s.paymentStatus)).toHaveValue('UNPAID');
    expect(screen.getByText(strings.pagination.summary(1, 25, 30))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.pagination.next }));
    expect(await screen.findByRole('link', { name: 'NIM-0017' })).toBeInTheDocument();
    expect(lastPath(api)).toBe('/orders?page=2&paymentStatus=UNPAID');
    expect(router.state.location.search).toBe('?page=2&paymentStatus=UNPAID');
  });

  it('invites the seller to take a first order', async () => {
    setup('/orders', (api) => api.on('GET', '/orders', () => page([])));
    expect(await screen.findByRole('heading', { name: s.emptyTitle })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: s.add });
    expect(links.every((link) => link.getAttribute('href') === '/orders/new')).toBe(true);
  });

  it('says when nothing matches, and offers to clear the filters', async () => {
    const { router } = setup('/orders?orderStatus=CANCELLED&q=kasun', (api) =>
      api.on('GET', '/orders', () => page([])),
    );
    expect(await screen.findByText(s.noMatches)).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: s.clearFilters });
    await userEvent.click(clear.at(-1) as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('explains a failure (e.g. a bad date range) and can try again', async () => {
    let fail = true;
    setup('/orders?from=2026-11-02&to=2026-11-01', (api) =>
      api.on('GET', '/orders', () =>
        fail
          ? errorReply(400, 'VALIDATION_ERROR', 'The end date must be on or after the start date.', {
              to: 'The end date must be on or after the start date.',
            })
          : page([order()]),
      ),
    );
    expect(await screen.findByText(s.loadFailed)).toBeInTheDocument();
    expect(screen.getByText('The end date must be on or after the start date.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
