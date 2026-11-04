// "Labels associated with form controls" (docs/DEVELOPMENT.md §6.9): opens every form in the app and
// fails if any input, drop-down or text area has no accessible name. Add new forms to FORMS.
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../lib/strings';
import { createFakeApi, newcomerMe } from '../test/fake-api';
import type { FakeApi } from '../test/fake-api';
import { createFakeAuth, fakeSession } from '../test/fake-auth';
import { renderApp } from '../test/render-app';

const CUSTOMER_ID = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const emptyPage = { status: 200, body: { items: [], page: 1, pageSize: 25, total: 0 } };

interface FormCase {
  name: string;
  path: string;
  api?: (api: FakeApi) => void;
  me?: ReturnType<typeof newcomerMe>;
  /** Waits for the form and opens any hidden parts of it. */
  open: () => Promise<void>;
}

const FORMS: FormCase[] = [
  {
    name: 'onboarding',
    path: '/onboarding',
    me: newcomerMe(),
    open: async () => {
      await screen.findByRole('heading', { name: strings.onboarding.title });
    },
  },
  {
    name: 'customer list search',
    path: '/customers',
    api: (api) => api.on('GET', '/customers', () => emptyPage),
    open: async () => {
      await screen.findByRole('heading', { name: strings.customers.list.title });
    },
  },
  {
    name: 'add customer, with the address section open',
    path: '/customers/new',
    open: async () => {
      await userEvent.click(
        await screen.findByRole('checkbox', { name: strings.customers.create.addAddress }),
      );
    },
  },
  {
    name: 'address form on the customer page',
    path: `/customers/${CUSTOMER_ID}`,
    api: (api) =>
      api.on('GET', `/customers/${CUSTOMER_ID}`, () => ({
        status: 200,
        body: {
          id: CUSTOMER_ID,
          name: 'Label Demo',
          phone: null,
          phoneE164: null,
          phoneWarning: null,
          email: null,
          archivedAt: null,
          orderCount: 0,
          lastOrderAt: null,
          notes: null,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          addresses: [],
        },
      })),
    open: async () => {
      await userEvent.click(
        await screen.findByRole('button', { name: strings.customers.addresses.add }),
      );
    },
  },
  {
    name: 'product list search',
    path: '/products',
    api: (api) => api.on('GET', '/products', () => emptyPage),
    open: async () => {
      await screen.findByRole('heading', { name: strings.products.list.title });
    },
  },
  {
    name: 'add product',
    path: '/products/new',
    open: async () => {
      await screen.findByRole('heading', { name: strings.products.create.title });
    },
  },
  {
    name: 'orders list, search and filters',
    path: '/orders',
    api: (api) => api.on('GET', '/orders', () => emptyPage),
    open: async () => {
      await screen.findByRole('heading', { level: 1, name: strings.orders.list.title });
    },
  },
  {
    name: 'new order, with a second item line',
    path: '/orders/new',
    open: async () => {
      await screen.findByRole('heading', { level: 1, name: strings.nav.newOrder });
      await userEvent.click(screen.getByRole('button', { name: strings.orders.form.item.add }));
    },
  },
];

describe('every form control has a label (§6.9)', () => {
  it.each(FORMS.map((form) => [form.name, form] as const))('%s', async (_name, form) => {
    const api = createFakeApi(form.me === undefined ? {} : { me: form.me });
    form.api?.(api);
    renderApp(form.path, createFakeAuth(fakeSession()), api);
    await form.open();

    const controls = Array.from(
      document.body.querySelectorAll<HTMLElement>('input, select, textarea'),
    ).filter((control) => control.getAttribute('type') !== 'hidden');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control).toHaveAccessibleName();
  });
});
