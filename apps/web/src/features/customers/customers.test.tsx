// Customers screens (docs/DEVELOPMENT.md §6.6, task B6), on the real routes and API client over a
// fake fetch, so each test checks exactly what the app sends. Fake people and numbers only.
import type { CustomerAddressView, CustomerDetail, CustomerSummary, Page } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply, TEST_REQUEST_ID } from '../../test/fake-api';
import type { FakeApi, RecordedCall } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.customers;
const ID = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const HOME_ID = '7b2a4d3f-5c6e-4f70-9b8c-1d2e3f4a5b6c';
const OFFICE_ID = '8c3b5e4a-6d7f-4081-ac9d-2e3f4a5b6c7d';

function summary(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: ID,
    name: 'Nimali Demo',
    phone: '077 123 4567',
    phoneE164: '+94771234567',
    phoneWarning: null,
    email: null,
    archivedAt: null,
    orderCount: 3,
    // 20:00 UTC on 19 Oct is 20 Oct in Colombo, the test business's timezone.
    lastOrderAt: '2026-10-19T20:00:00.000Z',
    ...overrides,
  };
}

function address(overrides: Partial<CustomerAddressView> = {}): CustomerAddressView {
  return {
    id: HOME_ID,
    label: 'Home',
    recipientName: 'Nimali Demo',
    phone: '077 123 4567',
    addressLine1: '12 Temple Road',
    addressLine2: null,
    city: 'Kandy',
    district: 'Kandy',
    postalCode: null,
    isDefault: true,
    ...overrides,
  };
}

function detail(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    ...summary(),
    notes: 'Prefers WhatsApp',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    addresses: [],
    ...overrides,
  };
}

function page(items: CustomerSummary[], overrides: Partial<Page<CustomerSummary>> = {}) {
  return { items, page: 1, pageSize: 25, total: items.length, ...overrides };
}

function setup(path: string, configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  // The customer page also shows the order history (C16); empty unless a test says otherwise.
  api.on('GET', `/customers/${ID}/orders`, () => ({
    status: 200,
    body: { items: [], page: 1, pageSize: 10, total: 0 },
  }));
  configure(api);
  const router = renderApp(path, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const requests = (api: FakeApi, method: string) =>
  api.calls.filter((call: RecordedCall) => call.method === method && call.path !== '/me');

describe('customer list (§6.6)', () => {
  it('shows customers as cards (mobile) and a table (desktop) with orders and last order date', async () => {
    setup('/customers', (api) =>
      api.on('GET', '/customers', () => ({ status: 200, body: page([summary()]) })),
    );
    const cards = await screen.findByRole('list', { name: s.list.listLabel });
    const card = within(cards).getByRole('link', { name: /Nimali Demo/ });
    expect(card).toHaveAttribute('href', `/customers/${ID}`);
    expect(card).toHaveTextContent('077 123 4567');
    expect(card).toHaveTextContent(s.list.orderSummary(3, '20 Oct 2026'));

    const table = screen.getByRole('table', { name: s.list.listLabel });
    const row = within(table).getByRole('row', { name: /Nimali Demo/ });
    expect(within(row).getByRole('link', { name: 'Nimali Demo' })).toHaveAttribute(
      'href',
      `/customers/${ID}`,
    );
    expect(row).toHaveTextContent('20 Oct 2026');
  });

  it('searches as you type (after a pause), keeps the search in the URL, and offers to clear it', async () => {
    const { api, router } = setup('/customers', (api) =>
      api.on('GET', '/customers', (call) => ({
        status: 200,
        body: page(call.path.includes('q=') ? [] : [summary()]),
      })),
    );
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: s.list.search }), '0771');

    expect(await screen.findByText(s.list.noMatches('0771'))).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=0771');
    // One request for the settled text, not one per key.
    expect(requests(api, 'GET').map((call) => call.path)).toEqual([
      '/customers',
      '/customers?q=0771',
    ]);

    await userEvent.click(screen.getByRole('button', { name: s.list.clearSearch }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: s.list.search })).toHaveValue('');
  });

  it('shows archived customers only when asked, and pages with Previous / Next', async () => {
    const { api } = setup('/customers', (api) =>
      api.on('GET', '/customers', () => ({
        status: 200,
        body: page([summary()], { total: 30 }),
      })),
    );
    await screen.findByRole('table');
    expect(screen.getByText(strings.pagination.summary(1, 25, 30))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.pagination.previous })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: strings.pagination.next }));
    await waitFor(() => expect(requests(api, 'GET').at(-1)?.path).toBe('/customers?page=2'));

    await userEvent.click(screen.getByRole('checkbox', { name: s.list.showArchived }));
    // A new filter starts again on page 1.
    await waitFor(() =>
      expect(requests(api, 'GET').at(-1)?.path).toBe('/customers?includeArchived=true'),
    );
  });

  it('invites the seller to add the first customer when there are none', async () => {
    setup('/customers', (api) =>
      api.on('GET', '/customers', () => ({ status: 200, body: page([]) })),
    );
    expect(await screen.findByRole('heading', { name: s.list.emptyTitle })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: s.list.add })[0]).toHaveAttribute(
      'href',
      '/customers/new',
    );
  });

  it('explains a failure, with a reference and a way to try again', async () => {
    let fail = true;
    setup('/customers', (api) =>
      api.on('GET', '/customers', () =>
        fail
          ? errorReply(503, 'SERVICE_UNAVAILABLE', 'Try later.')
          : { status: 200, body: page([summary()]) },
      ),
    );
    expect(await screen.findByText(s.list.loadFailed, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(strings.api.reference(TEST_REQUEST_ID))).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('add customer', () => {
  it('validates with the shared rules before sending anything', async () => {
    const { api } = setup('/customers/new');
    await userEvent.click(await screen.findByRole('button', { name: s.create.submit }));
    expect(await screen.findByText('Enter the customer’s name.')).toBeInTheDocument();
    expect(requests(api, 'POST')).toEqual([]);
  });

  it('creates the customer with a first address (pre-filled from the customer) and opens it', async () => {
    const { api, router } = setup('/customers/new', (api) => {
      api.on('POST', '/customers', () => ({
        status: 201,
        body: detail({ addresses: [address()] }),
      }));
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address()] }),
      }));
    });
    await userEvent.type(await screen.findByLabelText(s.fields.name), ' Nimali Demo ');
    await userEvent.type(screen.getByLabelText(s.fields.phone), '077 123 4567');
    await userEvent.click(screen.getByRole('checkbox', { name: s.create.addAddress }));

    const f = s.addresses.fields;
    expect(screen.getByLabelText(f.recipientName)).toHaveValue(' Nimali Demo ');
    expect(screen.getByLabelText(f.phone)).toHaveValue('077 123 4567');
    await userEvent.type(screen.getByLabelText(f.addressLine1), '12 Temple Road');
    await userEvent.type(screen.getByLabelText(f.city), 'Kandy');
    // District is a fixed list (§7.11).
    await userEvent.selectOptions(screen.getByLabelText(f.district), 'Kandy');
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));

    expect(
      await screen.findByRole('heading', { name: 'Nimali Demo', level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/customers/${ID}`);
    expect(requests(api, 'POST')[0]?.body).toEqual({
      name: 'Nimali Demo',
      phone: '077 123 4567',
      email: null,
      notes: null,
      address: {
        recipientName: 'Nimali Demo',
        phone: '077 123 4567',
        addressLine1: '12 Temple Road',
        addressLine2: null,
        city: 'Kandy',
        district: 'Kandy',
        postalCode: null,
        label: null,
      },
    });
  });

  it('sends no address when the address section is closed again', async () => {
    const { api } = setup('/customers/new', (api) =>
      api.on('POST', '/customers', () => ({ status: 201, body: detail() })),
    );
    await userEvent.type(await screen.findByLabelText(s.fields.name), 'Kasun Demo');
    const toggle = screen.getByRole('checkbox', { name: s.create.addAddress });
    await userEvent.click(toggle);
    await userEvent.type(screen.getByLabelText(s.addresses.fields.addressLine1), 'half typed');
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));
    await waitFor(() => expect(requests(api, 'POST')).toHaveLength(1));
    expect(requests(api, 'POST')[0]?.body).not.toHaveProperty('address');
  });

  it('shows a field error from the server next to the field, and keeps what was typed', async () => {
    setup('/customers/new', (api) =>
      api.on('POST', '/customers', () =>
        errorReply(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
          email: 'Enter a valid email address, like name@example.com.',
        }),
      ),
    );
    await userEvent.type(await screen.findByLabelText(s.fields.name), 'Kasun Demo');
    await userEvent.click(screen.getByRole('button', { name: s.create.submit }));
    const email = screen.getByLabelText(s.fields.email);
    await waitFor(() => expect(email).toHaveAccessibleDescription(/Enter a valid email address/));
    expect(screen.getByLabelText(s.fields.name)).toHaveValue('Kasun Demo');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('customer detail', () => {
  const twoAddresses = () =>
    detail({
      addresses: [
        address(),
        address({
          id: OFFICE_ID,
          label: 'Office',
          addressLine1: '5 Office Lane',
          isDefault: false,
        }),
      ],
    });

  it('shows the details, the order count and last order date, and the addresses (default first)', async () => {
    setup(`/customers/${ID}`, (api) =>
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: twoAddresses(),
      })),
    );
    expect(
      await screen.findByRole('heading', { name: 'Nimali Demo', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('20 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Prefers WhatsApp')).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(within(cards[0] as HTMLElement).getByText(s.addresses.default)).toBeInTheDocument();
    expect(
      within(cards[1] as HTMLElement).getByRole('heading', { name: 'Office' }),
    ).toBeInTheDocument();
  });

  it('warns when the phone number could not be read', async () => {
    setup(`/customers/${ID}`, (api) =>
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: detail({ phone: '12345', phoneE164: null, phoneWarning: 'PHONE_UNREADABLE' }),
      })),
    );
    expect(await screen.findByText(s.detail.phoneUnreadable)).toBeInTheDocument();
  });

  it('makes another address the default', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: twoAddresses() }));
      api.on('PATCH', `/customers/${ID}/addresses/${OFFICE_ID}`, () => ({
        status: 200,
        body: detail({
          addresses: [
            address({
              id: OFFICE_ID,
              label: 'Office',
              addressLine1: '5 Office Lane',
              isDefault: true,
            }),
            address({ isDefault: false }),
          ],
        }),
      }));
    });
    const office = await screen.findByRole('heading', { name: 'Office' });
    const card = office.closest('article') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: s.addresses.makeDefault }));

    await waitFor(() =>
      expect(
        within(screen.getAllByRole('article')[0] as HTMLElement).getByText('Office'),
      ).toBeInTheDocument(),
    );
    expect(requests(api, 'PATCH')[0]?.body).toEqual({ isDefault: true });
  });

  it('adds an address, pre-filled with the customer’s name and phone', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() }));
      api.on('POST', `/customers/${ID}/addresses`, () => ({
        status: 201,
        body: detail({ addresses: [address()] }),
      }));
    });
    expect(await screen.findByText(s.addresses.empty)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.addresses.add }));
    const f = s.addresses.fields;
    expect(screen.getByLabelText(f.recipientName)).toHaveValue('Nimali Demo');
    // The first address is the default anyway, so the choice isn't offered.
    expect(screen.queryByRole('checkbox', { name: f.isDefault })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(f.addressLine1), '12 Temple Road');
    await userEvent.click(screen.getByRole('button', { name: s.addresses.submitNew }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(requests(api, 'POST')[0]?.body).toMatchObject({
      recipientName: 'Nimali Demo',
      phone: '077 123 4567',
      addressLine1: '12 Temple Road',
      isDefault: false,
    });
  });

  it('offers the 25 districts, and keeps a district saved before the list existed', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address({ district: 'Kandy town' })] }),
      }));
      api.on('PATCH', `/customers/${ID}/addresses/${HOME_ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address({ district: 'Kandy town', label: 'Main' })] }),
      }));
    });
    const card = (await screen.findByRole('heading', { name: 'Home' })).closest(
      'article',
    ) as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: strings.common.edit }));

    const district = screen.getByLabelText(s.addresses.fields.district);
    expect(district).toHaveValue('Kandy town');
    // The placeholder, the saved value, and the 25 districts.
    expect(within(district).getAllByRole('option')).toHaveLength(27);

    await userEvent.clear(screen.getByLabelText(s.addresses.fields.label));
    await userEvent.type(screen.getByLabelText(s.addresses.fields.label), 'Main');
    await userEvent.click(screen.getByRole('button', { name: s.addresses.submitEdit }));
    await waitFor(() => expect(requests(api, 'PATCH')).toHaveLength(1));
    // The district wasn't touched, so it isn't sent (and isn't cleared).
    expect(requests(api, 'PATCH')[0]?.body).toEqual({ label: 'Main' });
  });

  it('edits an address, sending only what changed', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address()] }),
      }));
      api.on('PATCH', `/customers/${ID}/addresses/${HOME_ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address({ city: null })] }),
      }));
    });
    const card = (await screen.findByRole('heading', { name: 'Home' })).closest(
      'article',
    ) as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: strings.common.edit }));
    await userEvent.clear(screen.getByLabelText(s.addresses.fields.city));
    await userEvent.click(screen.getByRole('button', { name: s.addresses.submitEdit }));
    await waitFor(() => expect(requests(api, 'PATCH')).toHaveLength(1));
    expect(requests(api, 'PATCH')[0]?.body).toEqual({ city: null });
  });

  it('removes an address only after confirming', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: twoAddresses() }));
      api.on('POST', `/customers/${ID}/addresses/${OFFICE_ID}/archive`, () => ({
        status: 200,
        body: detail({ addresses: [address()] }),
      }));
    });
    const card = (await screen.findByRole('heading', { name: 'Office' })).closest(
      'article',
    ) as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: s.addresses.remove }));
    const dialog = screen.getByRole('alertdialog', { name: s.addresses.removeDialog.title });
    await userEvent.click(
      within(dialog).getByRole('button', { name: s.addresses.removeDialog.confirm }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Office' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requests(api, 'POST').map((call) => call.path)).toEqual([
      `/customers/${ID}/addresses/${OFFICE_ID}/archive`,
    ]);
  });

  it('archives the customer after confirmation; cancel and Escape do nothing', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({
        status: 200,
        body: detail({ addresses: [address()] }),
      }));
      api.on('POST', `/customers/${ID}/archive`, () => ({
        status: 200,
        body: detail({ archivedAt: '2026-11-02T04:00:00.000Z', addresses: [address()] }),
      }));
    });
    const archiveButton = await screen.findByRole('button', { name: s.detail.archive });

    await userEvent.click(archiveButton);
    const dialog = screen.getByRole('alertdialog', { name: s.archiveDialog.title('Nimali Demo') });
    // The safe choice has focus.
    expect(within(dialog).getByRole('button', { name: strings.common.cancel })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(archiveButton).toHaveFocus();

    await userEvent.click(archiveButton);
    await userEvent.click(screen.getByRole('button', { name: s.archiveDialog.confirm }));
    expect(await screen.findByText(s.detail.archivedDone)).toBeInTheDocument();
    expect(screen.getByText(s.detail.archivedBanner)).toBeInTheDocument();
    // Read-only now: no edit, archive or address actions.
    expect(screen.queryByRole('link', { name: strings.common.edit })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: s.addresses.remove })).not.toBeInTheDocument();
    expect(requests(api, 'POST').map((call) => call.path)).toEqual([`/customers/${ID}/archive`]);
  });

  it('keeps the dialog open with the reason when archiving fails', async () => {
    setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() }));
      api.on('POST', `/customers/${ID}/archive`, () =>
        errorReply(503, 'SERVICE_UNAVAILABLE', 'Try later.'),
      );
    });
    await userEvent.click(await screen.findByRole('button', { name: s.detail.archive }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: s.archiveDialog.confirm }));
    expect(await within(dialog).findByText(strings.api.serverError)).toBeInTheDocument();
  });

  it('says "not found" for an unknown customer (or another business’s)', async () => {
    setup(`/customers/${ID}`);
    expect(
      await screen.findByRole('heading', { name: s.detail.notFoundTitle }),
    ).toBeInTheDocument();
  });
});

describe('edit customer', () => {
  it('sends only the changed fields, and clears a field left empty', async () => {
    const { api, router } = setup(`/customers/${ID}/edit`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() }));
      api.on('PATCH', `/customers/${ID}`, () => ({ status: 200, body: detail({ notes: null }) }));
    });
    const notes = await screen.findByLabelText(s.fields.notes);
    expect(screen.getByLabelText(s.fields.name)).toHaveValue('Nimali Demo');
    await userEvent.clear(notes);
    await userEvent.click(screen.getByRole('button', { name: s.edit.submit }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/customers/${ID}`));
    expect(requests(api, 'PATCH')[0]?.body).toEqual({ notes: null });
  });

  it('goes back without a request when nothing changed', async () => {
    const { api, router } = setup(`/customers/${ID}/edit`, (api) =>
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() })),
    );
    await userEvent.click(await screen.findByRole('button', { name: s.edit.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/customers/${ID}`));
    expect(requests(api, 'PATCH')).toEqual([]);
  });
});

describe('customer order history (§6.6, §9.2)', () => {
  const h = s.history;
  const order = (n: number) => ({
    id: `0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e${String(n).padStart(2, '0')}`,
    orderNumber: `NIM-00${n}`,
    createdAt: '2026-11-01T06:00:00.000Z',
    customerName: 'Nimali Demo',
    customerPhoneMasked: '077 ••• 4567',
    totalAmount: '3450.00',
    balanceDue: '0.00',
    stage: 'COMPLETED' as const,
    orderStatus: 'COMPLETED' as const,
    paymentStatus: 'PAID' as const,
    deliveryStatus: null,
    sourceChannel: 'WHATSAPP' as const,
    fulfilmentType: 'PICKUP' as const,
  });

  it('lists the customer’s orders, newest first, each linking to its details, in pages', async () => {
    const { api } = setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() }));
      api.on('GET', `/customers/${ID}/orders`, (call) =>
        call.path.includes('page=2')
          ? { status: 200, body: { items: [order(31)], page: 2, pageSize: 10, total: 11 } }
          : { status: 200, body: { items: [order(42)], page: 1, pageSize: 10, total: 11 } },
      );
    });
    const history = within(await screen.findByRole('list', { name: h.listLabel }));
    expect(history.getByRole('link', { name: 'NIM-0042' })).toHaveAttribute(
      'href',
      `/orders/${order(42).id}`,
    );
    expect(history.getByText(strings.orderStage.COMPLETED)).toBeInTheDocument();
    expect(history.getByText(strings.paymentStatus.PAID)).toBeInTheDocument();
    expect(history.getByText(strings.orders.list.total('LKR 3,450.00'))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.pagination.next }));
    expect(await screen.findByRole('link', { name: 'NIM-0031' })).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      `/customers/${ID}/orders?page=2&pageSize=10`,
    );
  });

  it('says when there are no orders yet', async () => {
    setup(`/customers/${ID}`, (api) =>
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() })),
    );
    expect(await screen.findByText(h.empty)).toBeInTheDocument();
  });

  it('explains a failure and can try again, without hiding the rest of the page', async () => {
    let fail = true;
    setup(`/customers/${ID}`, (api) => {
      api.on('GET', `/customers/${ID}`, () => ({ status: 200, body: detail() }));
      api.on('GET', `/customers/${ID}/orders`, () =>
        fail
          ? errorReply(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.')
          : { status: 200, body: { items: [order(42)], page: 1, pageSize: 10, total: 1 } },
      );
    });
    expect(await screen.findByText(h.loadFailed)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nimali Demo', level: 1 })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));
    expect(await screen.findByRole('link', { name: 'NIM-0042' })).toBeInTheDocument();
  });
});
