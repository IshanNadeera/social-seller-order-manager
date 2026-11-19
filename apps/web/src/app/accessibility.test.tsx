// Accessibility checks on every main screen (docs/DEVELOPMENT.md §6.9, task E8). With data loaded,
// each screen must have:
// - one page heading (h1), and headings that never skip a level going down;
// - a name on every button and link (icons alone are hidden from screen readers);
// - a visible keyboard focus style on everything that can take focus;
// - no positive tabindex (the page order is the keyboard order);
// - status badges with text and an icon, never colour alone.
// Labels on form controls are checked form by form in form-labels.test.tsx. Add new screens here.
import type { DashboardSummary, OrderDetail, OrderSummary } from '@ssom/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { strings } from '../lib/strings';
import { createFakeApi } from '../test/fake-api';
import type { FakeApi } from '../test/fake-api';
import { createFakeAuth, fakeSession } from '../test/fake-auth';
import { renderApp } from '../test/render-app';

const ORDER_ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const page = <T,>(items: T[]) => ({
  status: 200,
  body: { items, page: 1, pageSize: 25, total: items.length },
});

const summary: OrderSummary = {
  id: ORDER_ID,
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

const detail = {
  id: ORDER_ID,
  orderNumber: 'NIM-0042',
  orderStatus: 'READY',
  paymentStatus: 'UNPAID',
  stage: 'READY_TO_SEND',
  sourceChannel: 'WHATSAPP',
  sourceNote: null,
  fulfilmentType: 'DELIVERY',
  paymentMethod: 'COD',
  customer: {
    id: '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
    name: 'Kamala Perera',
    phone: '077 123 4567',
  },
  items: [
    {
      id: 'i1',
      productId: null,
      name: 'Silk Saree',
      sku: null,
      quantity: 1,
      unitPrice: '2100.00',
      lineTotal: '2100.00',
    },
  ],
  subtotal: '2100.00',
  discountAmount: '0.00',
  deliveryFee: '350.00',
  totalAmount: '2450.00',
  amountPaid: '0.00',
  amountRefunded: '0.00',
  balanceDue: '2450.00',
  refundOwed: '0.00',
  delivery: {
    status: 'PENDING',
    recipientName: 'Kamala Perera',
    phone: '0771234567',
    addressLine1: '12 Lake Road',
    addressLine2: null,
    city: 'Kandy',
    district: 'Kandy',
    postalCode: null,
    courierName: null,
    trackingNumber: null,
    codAmount: '2450.00',
    codStatus: 'PENDING',
  },
  notes: null,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
} as OrderDetail;

const figures: DashboardSummary = {
  timeZone: 'Asia/Colombo',
  today: { date: '2026-11-19', ordersCreated: 1 },
  now: {
    ordersNeedingAction: 1,
    readyToSend: 0,
    outForDelivery: 0,
    outstandingBalance: '2450.00',
    codOutForDelivery: '0.00',
    codWithCourier: '0.00',
    refundsOwed: '0.00',
  },
  period: {
    from: '2026-11-19',
    to: '2026-11-19',
    ordersCreated: 1,
    cancelled: 0,
    cancellationRate: 0,
    delivered: 0,
    orderValue: '2450.00',
    paymentsReceived: '0.00',
    refunds: '0.00',
    netReceived: '0.00',
  },
};

interface Screen {
  name: string;
  path: string;
  api?: (api: FakeApi) => void;
  /** Text that shows once the screen's data has loaded. */
  ready: string | RegExp;
}

const SCREENS: Screen[] = [
  {
    name: 'dashboard',
    path: '/',
    api: (api) => {
      api.on('GET', '/dashboard/summary', () => ({ status: 200, body: figures }));
      api.on('GET', '/orders', () => page([summary]));
    },
    ready: /Kamala Perera/,
  },
  {
    name: 'orders list',
    path: '/orders',
    api: (api) => api.on('GET', '/orders', () => page([summary])),
    ready: /Kamala Perera/,
  },
  { name: 'new order', path: '/orders/new', ready: strings.orders.form.submit },
  {
    name: 'order details',
    path: `/orders/${ORDER_ID}`,
    api: (api) => {
      api.on('GET', `/orders/${ORDER_ID}`, () => ({ status: 200, body: detail }));
      api.on('GET', `/orders/${ORDER_ID}/events`, () => page([]));
      api.on('GET', `/orders/${ORDER_ID}/payments`, () => page([]));
    },
    ready: strings.orders.delivery.move.DISPATCHED,
  },
  {
    name: 'COD to settle',
    path: '/cod',
    api: (api) => api.on('GET', '/cod/awaiting', () => page([])),
    ready: strings.orders.cod.emptyTitle,
  },
  {
    name: 'customers',
    path: '/customers',
    api: (api) => api.on('GET', '/customers', () => page([])),
    ready: strings.customers.list.title,
  },
  {
    name: 'products',
    path: '/products',
    api: (api) => api.on('GET', '/products', () => page([])),
    ready: strings.products.list.title,
  },
  { name: 'more', path: '/more', ready: strings.nav.settings },
];

/** Something a keyboard user can land on with Tab. */
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

describe('every main screen meets §6.9', () => {
  it.each(SCREENS.map((s) => [s.name, s] as const))('%s', async (_name, item) => {
    const api = createFakeApi();
    item.api?.(api);
    renderApp(item.path, createFakeAuth(fakeSession()), api);
    expect((await screen.findAllByText(item.ready)).length).toBeGreaterThan(0);

    // One page heading; going down, a heading is at most one level deeper than the one before.
    const headings = Array.from(document.body.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    expect(headings.filter((heading) => heading.tagName === 'H1')).toHaveLength(1);
    let level = 0;
    for (const heading of headings) {
      const next = Number(heading.tagName.slice(1));
      expect(next, `"${heading.textContent}" skips a heading level`).toBeLessThanOrEqual(level + 1);
      level = next;
    }

    const focusable = Array.from(document.body.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(focusable.length).toBeGreaterThan(0);
    for (const element of focusable) {
      const label = element.outerHTML.slice(0, 120);
      if (element.matches('a, button')) expect(element, label).toHaveAccessibleName();
      expect(Number(element.getAttribute('tabindex') ?? 0), label).toBeLessThanOrEqual(0);
      // A visible focus style of its own (the shared controls all have one).
      if (element.getAttribute('tabindex') !== '-1') {
        expect(element.className, `${label} has no focus style`).toMatch(/focus(-visible)?:/);
      }
    }

    for (const badge of Array.from(document.body.querySelectorAll('[data-badge]'))) {
      const icon = badge.querySelector('[aria-hidden="true"]');
      expect(icon?.textContent?.trim(), 'a badge has an icon').toBeTruthy();
      const text = (badge.textContent ?? '').replace(icon?.textContent ?? '', '').trim();
      expect(text, 'a badge has text').not.toBe('');
    }
  });
});
