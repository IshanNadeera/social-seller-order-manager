// The duplicate-order warning on the order form (docs/DEVELOPMENT.md §2.2, task E6), on the real
// routes and API client over a fake fetch. Fake data only.
import type { CustomerDetail, OrderDetail, Page, PossibleDuplicate } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const f = strings.orders.form;
const d = f.duplicate;
const CUSTOMER_ID = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const EARLIER_ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';

const customer: CustomerDetail = {
  id: CUSTOMER_ID,
  name: 'Nimali Demo',
  phone: '077 123 4567',
  phoneE164: '+94771234567',
  phoneWarning: null,
  email: null,
  archivedAt: null,
  orderCount: 1,
  lastOrderAt: null,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  addresses: [],
};

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 25, total: items.length });

function setup(found: PossibleDuplicate[]) {
  const api = createFakeApi();
  api.on('GET', '/products', () => ({ status: 200, body: page([]) }));
  api.on('GET', '/customers', () => ({ status: 200, body: page([customer]) }));
  api.on('GET', `/customers/${CUSTOMER_ID}`, () => ({ status: 200, body: customer }));
  api.on('GET', '/orders/possible-duplicates', () => ({ status: 200, body: found }));
  api.on('POST', '/orders', () => ({ status: 201, body: { id: 'new-order' } as OrderDetail }));
  renderApp('/orders/new', createFakeAuth(fakeSession()), api);
  return api;
}

const checks = (api: FakeApi) =>
  api.calls.filter((call) => call.path.startsWith('/orders/possible-duplicates'));
const review = () => within(screen.getByRole('region', { name: f.steps.review }));

/** A WhatsApp pickup for the customer: one item at 2,450, paid in cash. */
async function fillOrder() {
  await screen.findByRole('heading', { level: 1, name: strings.nav.newOrder });
  await userEvent.selectOptions(screen.getByLabelText(f.sourceChannel), 'WHATSAPP');
  await userEvent.type(screen.getByRole('searchbox', { name: f.customer.search }), 'nim');
  await userEvent.click(
    await within(await screen.findByRole('list', { name: f.customer.results })).findByRole(
      'button',
      { name: /Nimali Demo/ },
    ),
  );
  await userEvent.click(screen.getByRole('radio', { name: strings.fulfilmentType.PICKUP }));
  const item = within(screen.getByRole('group', { name: f.item.legend(1) }));
  await userEvent.type(item.getByLabelText(f.item.search), 'Silk Saree');
  await userEvent.type(item.getByLabelText(f.item.unitPrice), '2450');
  await userEvent.selectOptions(screen.getByLabelText(f.paymentMethod), 'CASH');
}

describe('duplicate-order warning (§2.2)', () => {
  it('warns about a similar recent order for this phone, but saving still works', async () => {
    const api = setup([
      {
        id: EARLIER_ID,
        orderNumber: 'NIM-0041',
        createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
        totalAmount: '2450.00',
        stage: 'NEW',
      },
    ]);
    await fillOrder();

    expect(await review().findByText(d.title, {}, { timeout: 3000 })).toBeInTheDocument();
    const list = within(review().getByRole('list', { name: d.listLabel }));
    expect(list.getByText(d.item('NIM-0041', 'LKR 2,450.00', 12))).toBeInTheDocument();
    const link = list.getByRole('link', { name: d.open('NIM-0041') });
    expect(link).toHaveAttribute('href', `/orders/${EARLIER_ID}`);
    expect(link).toHaveAttribute('target', '_blank');
    // The check asks about this customer and the total the form shows.
    expect(checks(api).at(-1)?.path).toBe(
      `/orders/possible-duplicates?customerId=${CUSTOMER_ID}&total=2450.00`,
    );

    // Only a warning: Save is not disabled and the order is sent.
    const save = review().getByRole('button', { name: f.submit });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path === '/orders')).toBe(
        true,
      ),
    );
  });

  it('says nothing when there is no similar order, and asks nothing before a customer is chosen', async () => {
    const api = setup([]);
    await screen.findByRole('heading', { level: 1, name: strings.nav.newOrder });
    expect(checks(api)).toEqual([]);
    await fillOrder();
    await waitFor(() => expect(checks(api).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(review().queryByText(d.title)).not.toBeInTheDocument();
  });
});
