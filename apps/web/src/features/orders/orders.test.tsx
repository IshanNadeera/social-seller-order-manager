// The order form (docs/DEVELOPMENT.md §6.4, task C13), on the real routes and API client over a fake
// fetch, so each test checks exactly what the app sends. Fake data only.
import type { CustomerDetail, OrderDetail, Page, ProductView } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi, FakeReply, RecordedCall } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const f = strings.orders.form;
const address = strings.customers.addresses.fields;
const PRODUCT_ID = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';
const CUSTOMER_ID = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const ADDRESS_ID = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ORDER_ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const product = (overrides: Partial<ProductView> = {}): ProductView => ({
  id: PRODUCT_ID,
  name: 'Silk Saree',
  sku: 'SAR-001',
  description: null,
  sellingPrice: '1500.00',
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const customer = (overrides: Partial<CustomerDetail> = {}): CustomerDetail => ({
  id: CUSTOMER_ID,
  name: 'Nimali Demo',
  phone: '077 123 4567',
  phoneE164: '+94771234567',
  phoneWarning: null,
  email: null,
  archivedAt: null,
  orderCount: 0,
  lastOrderAt: null,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  addresses: [
    {
      id: ADDRESS_ID,
      label: 'Home',
      recipientName: 'Nimali Demo',
      phone: '0771234567',
      addressLine1: '12 Lake Road',
      addressLine2: null,
      city: 'Kandy',
      district: 'Kandy',
      postalCode: null,
      isDefault: true,
    },
  ],
  ...overrides,
});

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 25, total: items.length });
const savedOrder = { status: 201, body: { id: ORDER_ID } as OrderDetail };

function setup(configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  api.on('GET', '/products', () => ({ status: 200, body: page([product()]) }));
  api.on('GET', '/customers', () => ({ status: 200, body: page([customer()]) }));
  api.on('GET', `/customers/${CUSTOMER_ID}`, () => ({ status: 200, body: customer() }));
  configure(api);
  const router = renderApp('/orders/new', createFakeAuth(fakeSession()), api);
  return { api, router };
}

const orderPosts = (api: FakeApi) =>
  api.calls.filter((call) => call.method === 'POST' && call.path === '/orders');
const line = (n: number) => within(screen.getByRole('group', { name: f.item.legend(n) }));
const review = () => within(screen.getByRole('region', { name: f.steps.review }));
/** An amount in the review summary, by its label. */
const summary = (label: string) => review().getByText(label).nextElementSibling?.textContent;

async function openForm() {
  await screen.findByRole('heading', { level: 1, name: strings.nav.newOrder });
}

/** Types into a line's item box and picks the catalogue product from the results. */
async function chooseProduct(n: number, search: string, name: RegExp) {
  await userEvent.type(line(n).getByLabelText(f.item.search), search);
  await userEvent.click(
    await within(await line(n).findByRole('list', { name: f.item.results })).findByRole('button', {
      name,
    }),
  );
}

async function setText(label: HTMLElement, text: string) {
  await userEvent.clear(label);
  await userEvent.type(label, text);
}

/** A walk-in pickup with one one-off item: the shortest valid order. */
async function fillWalkIn(quantity = '1') {
  await userEvent.selectOptions(screen.getByLabelText(f.sourceChannel), 'WALK_IN');
  await userEvent.type(line(1).getByLabelText(f.item.search), 'Gift wrapping');
  await setText(line(1).getByLabelText(f.item.quantity), quantity);
  await userEvent.type(line(1).getByLabelText(f.item.unitPrice), '200');
  await userEvent.selectOptions(screen.getByLabelText(f.paymentMethod), 'CASH');
}

describe('order form layout (§6.4)', () => {
  it('shows the fields in §6.4 order, delivery by default with the business fee', async () => {
    setup();
    await openForm();
    const sequence = [
      screen.getByLabelText(f.sourceChannel),
      screen.getByRole('searchbox', { name: f.customer.search }),
      screen.getByRole('radio', { name: strings.fulfilmentType.DELIVERY }),
      screen.getByLabelText(address.recipientName),
      screen.getByLabelText(address.addressLine1),
      line(1).getByLabelText(f.item.search),
      line(1).getByLabelText(f.item.quantity),
      line(1).getByLabelText(f.item.unitPrice),
      screen.getByLabelText(f.discount),
      screen.getByLabelText(f.deliveryFee),
      screen.getByLabelText(f.paymentMethod),
      screen.getByLabelText(f.received),
      screen.getByLabelText(f.notes),
      screen.getByRole('heading', { name: f.steps.review }),
      screen.getByRole('button', { name: f.submit }),
    ];
    sequence.slice(1).forEach((element, index) => {
      const previous = sequence[index];
      expect(
        previous && previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
    expect(screen.getByRole('radio', { name: strings.fulfilmentType.DELIVERY })).toBeChecked();
    expect(screen.getByLabelText(f.deliveryFee)).toHaveValue('350.00');
    // The order's address has no label field.
    expect(screen.queryByLabelText(address.label)).not.toBeInTheDocument();
  });

  it('a pickup order has no address or fee; a walk-in sale becomes a pickup', async () => {
    setup();
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText(f.sourceChannel), 'WALK_IN');
    expect(screen.getByRole('radio', { name: strings.fulfilmentType.PICKUP })).toBeChecked();
    expect(screen.queryByLabelText(address.recipientName)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(f.deliveryFee)).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: strings.paymentMethod.COD })).toBeDisabled();
  });
});

describe('creating an order', () => {
  it('fills the address from the customer, previews totals live, and saves once with an Idempotency-Key', async () => {
    let release: (reply: FakeReply) => void = () => {};
    const { api, router } = setup((api) =>
      api.on('POST', '/orders', () => new Promise<FakeReply>((resolve) => (release = resolve))),
    );
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText(f.sourceChannel), 'WHATSAPP');

    // 2 + 4: the customer, and their default address.
    await userEvent.type(screen.getByRole('searchbox', { name: f.customer.search }), 'nim');
    await userEvent.click(
      await within(await screen.findByRole('list', { name: f.customer.results })).findByRole(
        'button',
        { name: /Nimali Demo/ },
      ),
    );
    expect(await screen.findByText(f.customer.chosen('Nimali Demo'))).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(address.addressLine1)).toHaveValue('12 Lake Road'),
    );
    expect(screen.getByText(f.fromSavedAddress)).toBeInTheDocument();
    expect(screen.queryByLabelText(f.saveToCustomer)).not.toBeInTheDocument();

    // 5: a product (price filled in) and a one-off item.
    await chooseProduct(1, 'sar', /Silk Saree/);
    expect(line(1).getByText(f.item.chosen('Silk Saree'))).toBeInTheDocument();
    expect(line(1).getByLabelText(f.item.unitPrice)).toHaveValue('1500.00');
    await setText(line(1).getByLabelText(f.item.quantity), '2');
    expect(line(1).getByText(f.item.lineTotal('LKR 3,000.00'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: f.item.add }));
    await userEvent.type(line(2).getByLabelText(f.item.search), 'Gift wrapping');
    await userEvent.type(line(2).getByLabelText(f.item.unitPrice), '200');

    // 6–8, and the live preview: 3200 − 100 + 350 = 3450; 1000 received leaves 2450.
    await userEvent.type(screen.getByLabelText(f.discount), '100');
    expect(summary(f.summary.subtotal)).toBe('LKR 3,200.00');
    expect(summary(f.summary.deliveryFee)).toBe('LKR 350.00');
    expect(summary(f.summary.total)).toBe('LKR 3,450.00');
    await userEvent.selectOptions(screen.getByLabelText(f.paymentMethod), 'COD');
    await userEvent.type(screen.getByLabelText(f.received), '1000');
    await userEvent.selectOptions(screen.getByLabelText(f.receivedMethod), 'CASH');
    expect(summary(f.summary.balance)).toBe('LKR 2,450.00');

    // Save: disabled while the request runs; a second click sends nothing.
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    const pending = await screen.findByRole('button', { name: f.pending });
    expect(pending).toBeDisabled();
    await userEvent.click(pending);
    expect(orderPosts(api)).toHaveLength(1);

    const [post] = orderPosts(api) as [RecordedCall];
    expect(post.headers['Idempotency-Key']).toMatch(UUID);
    expect(post.body).toMatchObject({
      sourceChannel: 'WHATSAPP',
      customerId: CUSTOMER_ID,
      fulfilmentType: 'DELIVERY',
      items: [
        { productId: PRODUCT_ID, quantity: 2, unitPrice: '1500.00' },
        { name: 'Gift wrapping', quantity: 1, unitPrice: '200.00' },
      ],
      discountAmount: '100.00',
      deliveryFee: '350.00',
      paymentMethod: 'COD',
      initialPayment: { amount: '1000.00', method: 'CASH' },
      delivery: {
        recipientName: 'Nimali Demo',
        addressLine1: '12 Lake Road',
        district: 'Kandy',
        sourceAddressId: ADDRESS_ID,
      },
    });
    // The server takes a product's name from the catalogue, and calculates every total itself.
    const body = post.body as { items: object[] } & Record<string, unknown>;
    expect(body.items[0]).not.toHaveProperty('name');
    for (const field of ['subtotal', 'totalAmount', 'businessId'])
      expect(body).not.toHaveProperty(field);

    release(savedOrder);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/orders/${ORDER_ID}`));
  });

  it('a failed save keeps everything; a retry reuses the key, a changed order gets a new one', async () => {
    const replies: FakeReply[] = [
      errorReply(503, 'SERVICE_UNAVAILABLE', 'The service is busy. Please try again.'),
      errorReply(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
        'items[0].quantity': 'Enter a whole number from 1 to 9,999.',
      }),
      savedOrder,
    ];
    const { api, router } = setup((api) =>
      api.on('POST', '/orders', () => replies.shift() ?? savedOrder),
    );
    await openForm();
    await fillWalkIn();

    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText(f.failed)).toBeInTheDocument();
    // A server error is shown in the app's own words (§9.7), never the server's.
    expect(screen.getByText(strings.api.serverError)).toBeInTheDocument();
    expect(line(1).getByLabelText(f.item.search)).toHaveValue('Gift wrapping');
    expect(line(1).getByLabelText(f.item.unitPrice)).toHaveValue('200');
    expect(screen.getByLabelText(f.sourceChannel)).toHaveValue('WALK_IN');

    // The same order again: the same key, so it can never be saved twice.
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await line(1).findByText('Enter a whole number from 1 to 9,999.')).toBeInTheDocument();
    const [first, second] = orderPosts(api) as [RecordedCall, RecordedCall];
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);

    // A changed order is a new request with a new key.
    await setText(line(1).getByLabelText(f.item.quantity), '3');
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/orders/${ORDER_ID}`));
    const third = orderPosts(api)[2];
    expect(third?.headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key']);
    expect(third?.body).toMatchObject({ items: [{ name: 'Gift wrapping', quantity: 3 }] });
  });

  it('checks the order in the browser first, with the API’s own messages', async () => {
    const { api } = setup();
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: f.submit }));
    expect(await screen.findByText('Choose where the order came from.')).toBeInTheDocument();
    expect(screen.getByText('Choose how the customer will pay.')).toBeInTheDocument();
    expect(orderPosts(api)).toHaveLength(0);
  });
});

describe('quick-add in a sheet keeps the order', () => {
  it('adds a customer without losing the items typed so far', async () => {
    const created = customer({
      id: CUSTOMER_ID,
      name: 'Kasun Demo',
      phone: '071 234 5678',
      addresses: [],
    });
    const { api } = setup((api) =>
      api.on('POST', '/customers', () => ({ status: 201, body: created })),
    );
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText(f.sourceChannel), 'FACEBOOK');
    await userEvent.type(line(1).getByLabelText(f.item.search), 'Gift wrapping');
    await userEvent.type(line(1).getByLabelText(f.item.unitPrice), '200');

    await userEvent.type(screen.getByRole('searchbox', { name: f.customer.search }), 'Kasun Demo');
    await userEvent.click(screen.getByRole('button', { name: f.customer.add }));
    const sheet = within(
      await screen.findByRole('dialog', { name: strings.orders.quickCustomer.title }),
    );
    expect(sheet.getByLabelText(strings.orders.quickCustomer.name)).toHaveValue('Kasun Demo');
    await userEvent.type(sheet.getByLabelText(strings.orders.quickCustomer.phone), '0712345678');
    await userEvent.click(sheet.getByRole('button', { name: strings.orders.quickCustomer.submit }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(f.customer.chosen('Kasun Demo'))).toBeInTheDocument();
    expect(
      api.calls.find((call) => call.method === 'POST' && call.path === '/customers')?.body,
    ).toEqual({
      name: 'Kasun Demo',
      phone: '0712345678',
    });
    // The sheet's form never submitted the order, and nothing typed was lost.
    expect(orderPosts(api)).toHaveLength(0);
    expect(screen.getByLabelText(f.sourceChannel)).toHaveValue('FACEBOOK');
    expect(line(1).getByLabelText(f.item.search)).toHaveValue('Gift wrapping');
    expect(line(1).getByLabelText(f.item.unitPrice)).toHaveValue('200');
    // A new customer has no saved address: the recipient starts as the customer.
    await waitFor(() =>
      expect(screen.getByLabelText(address.recipientName)).toHaveValue('Kasun Demo'),
    );
    expect(screen.getByLabelText(f.saveToCustomer)).toBeInTheDocument();
  });

  it('adds a product from an order line and puts it on that line', async () => {
    const created = product({
      id: PRODUCT_ID,
      name: 'Batik scarf',
      sku: null,
      sellingPrice: '950.00',
    });
    const { api } = setup((api) => {
      api.on('GET', '/products', () => ({ status: 200, body: page([]) }));
      api.on('POST', '/products', () => ({ status: 201, body: created }));
    });
    await openForm();
    await userEvent.type(screen.getByLabelText(f.notes), 'Wrap as a gift');
    await userEvent.type(line(1).getByLabelText(f.item.search), 'Batik scarf');
    await userEvent.click(line(1).getByRole('button', { name: f.item.newProduct }));

    const sheet = within(
      await screen.findByRole('dialog', { name: strings.orders.quickProduct.title }),
    );
    expect(sheet.getByLabelText(strings.orders.quickProduct.name)).toHaveValue('Batik scarf');
    await userEvent.type(sheet.getByLabelText(strings.orders.quickProduct.price), '950');
    await userEvent.click(sheet.getByRole('button', { name: strings.orders.quickProduct.submit }));

    expect(await line(1).findByText(f.item.chosen('Batik scarf'))).toBeInTheDocument();
    expect(line(1).getByLabelText(f.item.unitPrice)).toHaveValue('950.00');
    expect(screen.getByLabelText(f.notes)).toHaveValue('Wrap as a gift');
    expect(
      api.calls.find((call) => call.method === 'POST' && call.path === '/products')?.body,
    ).toEqual({
      name: 'Batik scarf',
      sellingPrice: '950.00',
    });
    expect(orderPosts(api)).toHaveLength(0);
  });

  it('editing a filled-in address unlinks it from the saved one and offers to save it', async () => {
    setup();
    await openForm();
    await userEvent.type(screen.getByRole('searchbox', { name: f.customer.search }), 'nim');
    await userEvent.click(
      await within(await screen.findByRole('list', { name: f.customer.results })).findByRole(
        'button',
        { name: /Nimali Demo/ },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(address.addressLine1)).toHaveValue('12 Lake Road'),
    );
    await setText(screen.getByLabelText(address.addressLine1), '5 Temple Street');
    expect(screen.queryByText(f.fromSavedAddress)).not.toBeInTheDocument();
    expect(screen.getByLabelText(f.saveToCustomer)).toBeInTheDocument();
  });
});
