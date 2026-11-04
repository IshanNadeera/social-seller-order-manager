// Order details (docs/DEVELOPMENT.md §6.5, task C15), on the real routes and API client over a fake
// fetch, so each test checks exactly what the app sends. Fake data only.
import type { MeResponse, OrderDetail, OrderEventView, Page } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply, memberMe } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const d = strings.orders.detail;
const r = strings.orders.reasonSheet;
const t = strings.orders.timeline;
const ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const CUSTOMER_ID = '6a1f3c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const PATH = `/orders/${ID}`;

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    orderNumber: 'NIM-0042',
    orderStatus: 'NEW',
    paymentStatus: 'PARTIALLY_PAID',
    stage: 'NEW',
    sourceChannel: 'WHATSAPP',
    sourceNote: null,
    fulfilmentType: 'DELIVERY',
    paymentMethod: 'COD',
    customer: { id: CUSTOMER_ID, name: 'Nimali Demo', phone: '077 123 4567' },
    items: [
      {
        id: 'i1',
        productId: '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e',
        name: 'Silk Saree',
        sku: 'SAR-001',
        quantity: 2,
        unitPrice: '1500.00',
        lineTotal: '3000.00',
      },
      {
        id: 'i2',
        productId: null,
        name: 'Gift wrapping',
        sku: null,
        quantity: 1,
        unitPrice: '200.00',
        lineTotal: '200.00',
      },
    ],
    subtotal: '3200.00',
    discountAmount: '100.00',
    deliveryFee: '350.00',
    totalAmount: '3450.00',
    amountPaid: '1000.00',
    amountRefunded: '0.00',
    balanceDue: '2450.00',
    refundOwed: '0.00',
    delivery: {
      status: 'PENDING',
      recipientName: 'Nimali Demo',
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
    notes: 'Deliver on Saturday',
    createdAt: '2026-11-01T06:00:00.000Z',
    updatedAt: '2026-11-01T06:00:00.000Z',
    ...overrides,
  } as OrderDetail;
}

const events = (items: Partial<OrderEventView>[]): Page<OrderEventView> => ({
  items: items.map((item, index) => ({
    id: `e${index}`,
    type: 'ORDER_CREATED',
    actor: { id: 'u1', name: 'Nimali' },
    oldValue: null,
    newValue: null,
    reason: null,
    createdAt: '2026-11-01T06:00:00.000Z',
    ...item,
  })),
  page: 1,
  pageSize: 25,
  total: items.length,
});

function setup(
  current: OrderDetail,
  configure: (api: FakeApi) => void = () => {},
  me: MeResponse = memberMe(),
) {
  const api = createFakeApi({ me });
  api.on('GET', PATH, () => ({ status: 200, body: current }));
  api.on('GET', `${PATH}/events`, () => ({
    status: 200,
    body: events([{ newValue: { totalAmount: '3450.00' } }]),
  }));
  configure(api);
  const router = renderApp(PATH, createFakeAuth(fakeSession()), api);
  return { api, router };
}

const section = (name: string) => within(screen.getByRole('region', { name }));
const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST');

describe('order details (§6.5)', () => {
  it('shows the number, date, stage, customer, delivery copy, items, money, notes and activity', async () => {
    setup(order(), (api) =>
      api.on('GET', `${PATH}/events`, () => ({
        status: 200,
        body: events([
          { newValue: { totalAmount: '3450.00' } },
          { type: 'PAYMENT_RECORDED', newValue: { amount: '1000.00', method: 'CASH' } },
          {
            type: 'ORDER_STATUS_CHANGED',
            oldValue: { orderStatus: 'NEW' },
            newValue: { orderStatus: 'CONFIRMED' },
            reason: 'Customer confirmed on WhatsApp',
            actor: null,
          },
        ]),
      })),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'NIM-0042' })).toBeInTheDocument();
    expect(screen.getByText(d.created('1 Nov 2026, 11:30'))).toBeInTheDocument();
    expect(screen.getAllByText(strings.orderStage.NEW).length).toBeGreaterThan(0);
    expect(screen.getByText(strings.paymentStatus.PARTIALLY_PAID)).toBeInTheDocument();

    const customer = section(d.sections.customer);
    expect(customer.getByText('Nimali Demo')).toBeInTheDocument();
    expect(customer.getByRole('link', { name: d.viewCustomer })).toHaveAttribute(
      'href',
      `/customers/${CUSTOMER_ID}`,
    );

    const delivery = section(d.sections.delivery);
    expect(delivery.getByText('12 Lake Road, Kandy, Kandy')).toBeInTheDocument();
    expect(delivery.getAllByText(d.notSet)).toHaveLength(2);
    expect(delivery.getByText('LKR 2,450.00')).toBeInTheDocument();
    expect(delivery.getByText(strings.codStatus.PENDING)).toBeInTheDocument();

    const items = section(d.sections.items);
    expect(items.getByText(d.quantity(2, 'LKR 1,500.00'), { exact: false })).toBeInTheDocument();
    expect(items.getByText('LKR 3,450.00')).toBeInTheDocument();

    const payment = section(d.sections.payment);
    expect(payment.getByText('LKR 1,000.00')).toBeInTheDocument();
    expect(payment.getByText('LKR 2,450.00')).toBeInTheDocument();
    expect(payment.queryByText(d.refundOwed)).not.toBeInTheDocument();

    expect(section(d.sections.notes).getByText('Deliver on Saturday')).toBeInTheDocument();

    const activity = within(await screen.findByRole('list', { name: t.title }));
    expect(activity.getByText(t.createdWithTotal('LKR 3,450.00'))).toBeInTheDocument();
    expect(activity.getByText(t.payment('LKR 1,000.00'))).toBeInTheDocument();
    expect(activity.getByText(t.status('New', 'Confirmed'))).toBeInTheDocument();
    expect(activity.getByText(t.reason('Customer confirmed on WhatsApp'))).toBeInTheDocument();
    expect(activity.getAllByText(/by Nimali/)).toHaveLength(2);
    expect(activity.getByText(t.automatic, { exact: false })).toBeInTheDocument();
  });

  it('shows a walk-in pickup without customer or delivery sections', async () => {
    setup(
      order({
        fulfilmentType: 'PICKUP',
        paymentMethod: 'CASH',
        customer: { id: null, name: 'Walk-in customer', phone: null },
        delivery: null,
        deliveryFee: '0.00',
        notes: null,
      }),
    );
    expect(await screen.findByText(d.walkIn)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: d.sections.delivery })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: d.sections.notes })).not.toBeInTheDocument();
  });

  it('says "not found" for a missing order, or another business’s', async () => {
    const api = createFakeApi();
    api.on('GET', PATH, () => errorReply(404, 'NOT_FOUND', 'Not found.'));
    renderApp(PATH, createFakeAuth(fakeSession()), api);
    expect(await screen.findByRole('heading', { name: d.notFoundTitle })).toBeInTheDocument();
  });
});

describe('status actions (§6.5, §7.2)', () => {
  const buttons = () =>
    section(d.sections.actions)
      .queryAllByRole('button')
      .map((button) => button.textContent);

  it('shows only the moves allowed now', async () => {
    setup(order());
    await screen.findByRole('heading', { level: 1, name: 'NIM-0042' });
    expect(buttons()).toEqual([d.move.PENDING_CONFIRMATION, d.move.CONFIRMED, d.move.CANCELLED]);
  });

  it('a dispatched delivery can’t be cancelled or completed here', async () => {
    const delivery = order().delivery;
    setup(
      order({
        orderStatus: 'READY',
        stage: 'OUT_FOR_DELIVERY',
        delivery: delivery && { ...delivery, status: 'DISPATCHED' },
      }),
    );
    expect(await screen.findByText(d.noActions)).toBeInTheDocument();
    expect(buttons()).toEqual([]);
  });

  it('a pickup that is ready can be collected; returning it later is for the owner only', async () => {
    const pickup = {
      fulfilmentType: 'PICKUP' as const,
      delivery: null,
      paymentMethod: 'CASH' as const,
    };
    setup(order({ ...pickup, orderStatus: 'READY', stage: 'READY_FOR_PICKUP' }));
    await screen.findByRole('heading', { level: 1, name: 'NIM-0042' });
    expect(buttons()).toEqual([d.move.COMPLETED, d.move.CANCELLED]);
  });

  it('staff don’t see the owner’s return correction', async () => {
    const completed = order({
      fulfilmentType: 'PICKUP',
      delivery: null,
      paymentMethod: 'CASH',
      orderStatus: 'COMPLETED',
      stage: 'COMPLETED',
    });
    setup(completed, () => {}, { ...memberMe(), role: 'STAFF' });
    expect(await screen.findByText(d.noActions)).toBeInTheDocument();
  });

  it('the owner can record a return, with a reason', async () => {
    const completed = order({
      fulfilmentType: 'PICKUP',
      delivery: null,
      paymentMethod: 'CASH',
      orderStatus: 'COMPLETED',
      stage: 'COMPLETED',
    });
    const { api } = setup(completed, (api) =>
      api.on('POST', `${PATH}/status`, () => ({
        status: 200,
        body: order({ ...completed, orderStatus: 'RETURNED', stage: 'RETURNED' }),
      })),
    );
    await userEvent.click(await screen.findByRole('button', { name: d.move.RETURNED }));
    const sheet = within(await screen.findByRole('dialog', { name: r.returnTitle('NIM-0042') }));
    await userEvent.type(sheet.getByLabelText(r.reason), 'Wrong size');
    await userEvent.click(sheet.getByRole('button', { name: r.returnConfirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts(api).at(-1)?.body).toEqual({ to: 'RETURNED', reason: 'Wrong size' });
  });

  it('moves the order on, and refreshes its stage and activity', async () => {
    let current = order();
    const { api } = setup(current, (api) => {
      api.on('GET', PATH, () => ({ status: 200, body: current }));
      api.on('POST', `${PATH}/status`, () => {
        current = order({ orderStatus: 'CONFIRMED', stage: 'CONFIRMED' });
        return { status: 200, body: current };
      });
    });
    await userEvent.click(await screen.findByRole('button', { name: d.move.CONFIRMED }));
    await waitFor(() =>
      expect(buttons()).toEqual([d.move.PREPARING, d.move.READY, d.move.CANCELLED]),
    );
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]?.body).toEqual({ to: 'CONFIRMED' });
    // The activity is loaded again, to show the change.
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.path.startsWith(`${PATH}/events`)).length,
      ).toBeGreaterThan(1),
    );
  });

  it('explains a refused move', async () => {
    setup(order(), (api) =>
      api.on('POST', `${PATH}/status`, () =>
        errorReply(
          422,
          'INVALID_TRANSITION',
          'This order can’t be moved to that status from where it is now.',
        ),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: d.move.CONFIRMED }));
    expect(await screen.findByText(d.statusFailed)).toBeInTheDocument();
    expect(
      screen.getByText('This order can’t be moved to that status from where it is now.'),
    ).toBeInTheDocument();
  });
});

describe('cancelling asks first (§6.3, §6.5)', () => {
  it('needs a reason, can be backed out of, and then cancels with the reason', async () => {
    const { api } = setup(order(), (api) =>
      api.on('POST', `${PATH}/cancel`, () => ({
        status: 200,
        body: order({
          orderStatus: 'CANCELLED',
          stage: 'CANCELLED',
          balanceDue: '0.00',
          refundOwed: '1000.00',
        }),
      })),
    );
    // Backing out sends nothing.
    await userEvent.click(await screen.findByRole('button', { name: d.move.CANCELLED }));
    let sheet = within(await screen.findByRole('dialog', { name: r.cancelTitle('NIM-0042') }));
    await userEvent.click(sheet.getByRole('button', { name: r.keep }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(api)).toHaveLength(0);

    // No reason: nothing is sent.
    await userEvent.click(screen.getByRole('button', { name: d.move.CANCELLED }));
    sheet = within(await screen.findByRole('dialog', { name: r.cancelTitle('NIM-0042') }));
    await userEvent.click(sheet.getByRole('button', { name: r.cancelConfirm }));
    expect(await sheet.findByText('Please give a reason.')).toBeInTheDocument();
    expect(posts(api)).toHaveLength(0);

    await userEvent.type(sheet.getByLabelText(r.reason), ' Customer changed their mind ');
    await userEvent.click(sheet.getByRole('button', { name: r.cancelConfirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]).toMatchObject({
      path: `${PATH}/cancel`,
      body: { reason: 'Customer changed their mind' },
    });
    // The cancelled order: no actions left, the money held shows as a refund owed.
    expect(await screen.findByText(d.noActions)).toBeInTheDocument();
    expect(section(d.sections.payment).getByText(d.refundOwed)).toBeInTheDocument();
  });
});
