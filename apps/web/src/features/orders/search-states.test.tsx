// Loading, empty and error states of the order form's two searches (docs/DEVELOPMENT.md §2.2,
// task E7): in plain language, never a dead end. Fake data only.
import type { CustomerSummary, Page, ProductView } from '@ssom/shared';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi, FakeReply } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const f = strings.orders.form;
const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 25, total: items.length });

const saree: ProductView = {
  id: '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e',
  name: 'Silk Saree',
  sku: 'SAR-001',
  description: null,
  sellingPrice: '1500.00',
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const nimali: CustomerSummary = {
  id: '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
  name: 'Nimali Demo',
  phone: '077 123 4567',
  archivedAt: null,
  orderCount: 0,
  lastOrderAt: null,
} as CustomerSummary;

/** A reply that fails until `fixed()` is called. */
function flaky(ok: () => FakeReply) {
  let down = true;
  return {
    reply: () => (down ? errorReply(503, 'UNAVAILABLE', 'Try again.') : ok()),
    fixed: () => {
      down = false;
    },
  };
}

function setup(configure: (api: FakeApi) => void) {
  const api = createFakeApi();
  configure(api);
  renderApp('/orders/new', createFakeAuth(fakeSession()), api);
  return api;
}

const item = () => within(screen.getByRole('group', { name: f.item.legend(1) }));
const openForm = () => screen.findByRole('heading', { level: 1, name: strings.nav.newOrder });

describe('product search on an item line (§2.2)', () => {
  it('no match says the name will be a one-off item', async () => {
    setup((api) => api.on('GET', '/products', () => ({ status: 200, body: page([]) })));
    await openForm();
    await userEvent.type(item().getByLabelText(f.item.search), 'Gift wrap');
    expect(await item().findByText(f.item.noProducts('Gift wrap'))).toBeInTheDocument();
  });

  it('a failed search says so, keeps the typing, and can be tried again', async () => {
    const products = flaky(() => ({ status: 200, body: page([saree]) }));
    setup((api) => api.on('GET', '/products', products.reply));
    await openForm();
    await userEvent.type(item().getByLabelText(f.item.search), 'Silk');
    // A 5xx is retried once on its own first, after about a second.
    const alert = await item().findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent(f.item.searchFailed);
    expect(item().getByLabelText(f.item.search)).toHaveValue('Silk');

    products.fixed();
    await userEvent.click(within(alert).getByRole('button', { name: strings.common.retry }));
    expect(
      await within(await item().findByRole('list', { name: f.item.results })).findByText(
        'Silk Saree',
      ),
    ).toBeInTheDocument();
  });
});

describe('customer search (§2.2)', () => {
  it('a failed search is announced and can be tried again', async () => {
    const customers = flaky(() => ({ status: 200, body: page([nimali]) }));
    setup((api) => api.on('GET', '/customers', customers.reply));
    await openForm();
    await userEvent.type(screen.getByRole('searchbox', { name: f.customer.search }), 'nim');
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent(f.customer.searchFailed);

    customers.fixed();
    await userEvent.click(within(alert).getByRole('button', { name: strings.common.retry }));
    expect(
      await within(await screen.findByRole('list', { name: f.customer.results })).findByText(
        /Nimali Demo/,
      ),
    ).toBeInTheDocument();
  });
});
