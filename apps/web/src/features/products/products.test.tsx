// Products screens (docs/DEVELOPMENT.md §6.7, task B7), on the real routes and API client over a
// fake fetch, so each test checks exactly what the app sends. Fake products only.
import type { Page, ProductView } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.products;
const ID = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';

function product(overrides: Partial<ProductView> = {}): ProductView {
  return {
    id: ID,
    name: 'Silk Saree',
    sku: 'SAR-001',
    description: 'Handloom',
    sellingPrice: '12500.50',
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function page(items: ProductView[], overrides: Partial<Page<ProductView>> = {}) {
  return { items, page: 1, pageSize: 25, total: items.length, ...overrides };
}

function setup(path: string, configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  configure(api);
  const router = renderApp(path, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const requests = (api: FakeApi, method: string) =>
  api.calls.filter((call) => call.method === method && call.path !== '/me');

describe('product list (§6.7)', () => {
  it('shows products with the price formatted from the string, cards and a table', async () => {
    setup('/products', (api) =>
      api.on('GET', '/products', () => ({ status: 200, body: page([product()]) })),
    );
    const cards = await screen.findByRole('list', { name: s.list.listLabel });
    const card = within(cards).getByRole('link', { name: /Silk Saree/ });
    expect(card).toHaveAttribute('href', `/products/${ID}`);
    expect(card).toHaveTextContent('LKR 12,500.50');
    expect(card).toHaveTextContent(s.list.sku('SAR-001'));

    const row = within(screen.getByRole('table', { name: s.list.listLabel })).getByRole('row', {
      name: /Silk Saree/,
    });
    expect(row).toHaveTextContent('SAR-001');
    expect(row).toHaveTextContent('LKR 12,500.50');
  });

  it('searches by name or SKU and can include archived products', async () => {
    const { api, router } = setup('/products', (api) =>
      api.on('GET', '/products', () => ({ status: 200, body: page([product()]) })),
    );
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: s.list.search }), 'sar-0');
    await waitFor(() => expect(requests(api, 'GET').at(-1)?.path).toBe('/products?q=sar-0'));
    expect(router.state.location.search).toBe('?q=sar-0');

    await userEvent.click(screen.getByRole('checkbox', { name: s.list.showArchived }));
    await waitFor(() =>
      expect(requests(api, 'GET').at(-1)?.path).toBe('/products?q=sar-0&includeArchived=true'),
    );
  });

  it('invites the seller to add a first product', async () => {
    setup('/products', (api) =>
      api.on('GET', '/products', () => ({ status: 200, body: page([]) })),
    );
    expect(await screen.findByRole('heading', { name: s.list.emptyTitle })).toBeInTheDocument();
  });
});

describe('add product', () => {
  it('sends the price as a string with two decimals, and no inventory fields', async () => {
    const { api, router } = setup('/products/new', (api) => {
      api.on('POST', '/products', () => ({ status: 201, body: product() }));
      api.on('GET', '/products', () => ({ status: 200, body: page([product()]) }));
    });
    await userEvent.type(await screen.findByLabelText(s.fields.name), 'Silk Saree');
    await userEvent.type(screen.getByLabelText(s.fields.sellingPrice), '12500.5');
    await userEvent.type(screen.getByLabelText(s.fields.sku), 'SAR-001');
    // §6.7: no stock or inventory fields.
    expect(screen.queryByLabelText(/stock|quantity|inventory/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect(requests(api, 'POST')[0]?.body).toEqual({
      name: 'Silk Saree',
      sku: 'SAR-001',
      sellingPrice: '12500.50',
      description: null,
    });
  });

  it('refuses a price that isn’t a valid amount, before sending anything', async () => {
    const { api } = setup('/products/new');
    await userEvent.type(await screen.findByLabelText(s.fields.name), 'Tea');
    await userEvent.type(screen.getByLabelText(s.fields.sellingPrice), '1,500');
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));
    expect(
      await screen.findByText('Enter an amount from 0 to 99,999,999.99, with at most 2 decimals.'),
    ).toBeInTheDocument();
    expect(requests(api, 'POST')).toEqual([]);
  });

  it('shows a SKU clash next to the SKU field and keeps the form', async () => {
    setup('/products/new', (api) =>
      api.on('POST', '/products', () =>
        errorReply(409, 'SKU_TAKEN', 'Another active product already uses this SKU.', {
          sku: 'Another active product already uses this SKU.',
        }),
      ),
    );
    await userEvent.type(await screen.findByLabelText(s.fields.name), 'Batik Shirt');
    await userEvent.type(screen.getByLabelText(s.fields.sellingPrice), '2500');
    await userEvent.type(screen.getByLabelText(s.fields.sku), 'BAT-1');
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));
    const sku = screen.getByLabelText(s.fields.sku);
    await waitFor(() => expect(sku).toHaveAccessibleDescription(/already uses this SKU/));
    expect(sku).toHaveValue('BAT-1');
    expect(screen.getByLabelText(s.fields.name)).toHaveValue('Batik Shirt');
  });
});

describe('edit and archive product', () => {
  it('sends only the changed fields', async () => {
    const { api, router } = setup(`/products/${ID}`, (api) => {
      api.on('GET', `/products/${ID}`, () => ({ status: 200, body: product() }));
      api.on('PATCH', `/products/${ID}`, () => ({
        status: 200,
        body: product({ sellingPrice: '13000.00', sku: null }),
      }));
      api.on('GET', '/products', () => ({ status: 200, body: page([product()]) }));
    });
    const price = await screen.findByLabelText(s.fields.sellingPrice);
    expect(price).toHaveValue('12500.50');
    await userEvent.clear(price);
    await userEvent.type(price, '13000');
    await userEvent.clear(screen.getByLabelText(s.fields.sku));
    await userEvent.click(screen.getByRole('button', { name: s.edit.submit }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect(requests(api, 'PATCH')[0]?.body).toEqual({ sellingPrice: '13000.00', sku: null });
  });

  it('archives after confirmation and then shows the product read-only', async () => {
    const { api } = setup(`/products/${ID}`, (api) => {
      api.on('GET', `/products/${ID}`, () => ({ status: 200, body: product() }));
      api.on('POST', `/products/${ID}/archive`, () => ({
        status: 200,
        body: product({ archivedAt: '2026-11-02T04:00:00.000Z' }),
      }));
    });
    await userEvent.click(await screen.findByRole('button', { name: s.edit.archive }));
    const dialog = screen.getByRole('alertdialog', { name: s.archiveDialog.title('Silk Saree') });
    await userEvent.click(within(dialog).getByRole('button', { name: s.archiveDialog.confirm }));

    expect(await screen.findByText(s.edit.archivedBanner)).toBeInTheDocument();
    expect(screen.getByText('LKR 12,500.50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: s.edit.submit })).not.toBeInTheDocument();
    expect(requests(api, 'POST').map((call) => call.path)).toEqual([`/products/${ID}/archive`]);
  });

  it('says "not found" for an unknown product (or another business’s)', async () => {
    setup(`/products/${ID}`);
    expect(await screen.findByRole('heading', { name: s.edit.notFoundTitle })).toBeInTheDocument();
  });
});
