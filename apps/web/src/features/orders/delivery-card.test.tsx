// The order page's delivery card (docs/DEVELOPMENT.md §6.5, §7.2, task D6), on the real routes and
// API client over a fake fetch, so each test checks exactly what the app sends. Fake data only.
import type { OrderDeliveryView, OrderDetail, PaymentRecorded } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply, memberMe } from '../../test/fake-api';
import type { FakeApi, RecordedCall } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';
import { localToday } from './payment-form';

const d = strings.orders.detail;
const v = strings.orders.delivery;
const ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const PATH = `/orders/${ID}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function delivery(overrides: Partial<OrderDeliveryView> = {}): OrderDeliveryView {
  return {
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
    ...overrides,
  };
}

/** A READY COD delivery order of 2450.00, nothing paid yet. */
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    orderNumber: 'NIM-0042',
    orderStatus: 'READY',
    paymentStatus: 'UNPAID',
    stage: 'READY_TO_SEND',
    sourceChannel: 'WHATSAPP',
    sourceNote: null,
    fulfilmentType: 'DELIVERY',
    paymentMethod: 'COD',
    customer: { id: null, name: 'Walk-in customer', phone: null },
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
    delivery: delivery(),
    notes: null,
    createdAt: '2026-11-01T06:00:00.000Z',
    updatedAt: '2026-11-01T06:00:00.000Z',
    ...overrides,
  } as OrderDetail;
}

const withDelivery = (overrides: Partial<OrderDeliveryView>, rest: Partial<OrderDetail> = {}) =>
  order({ ...rest, delivery: delivery(overrides) });

function setup(
  current: OrderDetail,
  configure: (api: FakeApi) => void = () => {},
  role: 'OWNER' | 'STAFF' = 'OWNER',
) {
  const api = createFakeApi({ me: { ...memberMe(), role } });
  const empty = { status: 200, body: { items: [], page: 1, pageSize: 25, total: 0 } };
  api.on('GET', PATH, () => ({ status: 200, body: current }));
  api.on('GET', `${PATH}/events`, () => empty);
  api.on('GET', `${PATH}/payments`, () => empty);
  configure(api);
  renderApp(PATH, createFakeAuth(fakeSession()), api);
  return { api };
}

const card = () => within(screen.getByRole('region', { name: d.sections.delivery }));
/** The delivery card once the order (and the user's role) has loaded. */
const loadedCard = async () => {
  await screen.findByRole('heading', { level: 1, name: 'NIM-0042' });
  return card();
};
const buttons = () =>
  card()
    .queryAllByRole('button')
    .map((button) => button.textContent);
const value = (label: string) => card().getByText(label).nextElementSibling;
const sheet = async (title: string) => within(await screen.findByRole('dialog', { name: title }));
const posts = (api: FakeApi, action: string) =>
  api.calls.filter((call) => call.method === 'POST' && call.path === `${PATH}/${action}`);

describe('delivery details (§6.5)', () => {
  it('shows status, courier, tracking, COD amount and COD status', async () => {
    setup(withDelivery({ status: 'DISPATCHED', courierName: 'Koombiyo', trackingNumber: 'KB123' }));
    await loadedCard();
    expect(value(d.deliveryStatus)).toHaveTextContent(strings.deliveryStatus.DISPATCHED);
    expect(value(d.courier)).toHaveTextContent('Koombiyo');
    expect(value(d.tracking)).toHaveTextContent('KB123');
    expect(value(d.codAmount)).toHaveTextContent('LKR 2,450.00');
    expect(value(d.codStatus)).toHaveTextContent(strings.codStatus.PENDING);
  });

  it('hides COD for a prepaid delivery', async () => {
    setup(
      withDelivery(
        { codAmount: '0.00', codStatus: 'NOT_APPLICABLE' },
        { paymentMethod: 'BANK_TRANSFER' },
      ),
    );
    await loadedCard();
    expect(card().queryByText(d.codAmount)).not.toBeInTheDocument();
  });
});

describe('delivery actions (§7.2)', () => {
  it('a pending delivery waits until the order is ready', async () => {
    setup(order({ orderStatus: 'CONFIRMED', stage: 'CONFIRMED' }));
    await loadedCard();
    expect(card().getByText(v.readyFirst)).toBeInTheDocument();
    expect(buttons()).toEqual([]);
  });

  it('dispatches with courier and tracking, then offers delivered or failed', async () => {
    const sent = withDelivery(
      { status: 'DISPATCHED', courierName: 'Koombiyo', trackingNumber: 'KB123' },
      { stage: 'OUT_FOR_DELIVERY' },
    );
    const { api } = setup(order(), (api) =>
      api.on('POST', `${PATH}/delivery/dispatch`, () => ({ status: 200, body: sent })),
    );
    await loadedCard();
    expect(buttons()).toEqual([v.move.DISPATCHED]);
    await userEvent.click(card().getByRole('button', { name: v.move.DISPATCHED }));
    const form = await sheet(v.dispatchSheet.title('NIM-0042'));
    await userEvent.type(form.getByLabelText(v.dispatchSheet.courier), 'Koombiyo');
    await userEvent.type(form.getByLabelText(v.dispatchSheet.tracking), 'KB123');
    await userEvent.click(form.getByRole('button', { name: v.dispatchSheet.submit }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [post] = posts(api, 'delivery/dispatch') as [RecordedCall];
    expect(post.body).toEqual({ courierName: 'Koombiyo', trackingNumber: 'KB123' });
    await waitFor(() => expect(buttons()).toEqual([v.move.DELIVERED, v.move.FAILED]));
    expect(value(d.tracking)).toHaveTextContent('KB123');
  });

  it('marks delivered in one tap; collected COD can then be settled', async () => {
    const delivered = withDelivery(
      { status: 'DELIVERED', codStatus: 'COLLECTED' },
      { orderStatus: 'COMPLETED', stage: 'COMPLETED' },
    );
    const { api } = setup(withDelivery({ status: 'DISPATCHED' }), (api) =>
      api.on('POST', `${PATH}/delivery/delivered`, () => ({ status: 200, body: delivered })),
    );
    await loadedCard();
    await userEvent.click(card().getByRole('button', { name: v.move.DELIVERED }));
    await waitFor(() => expect(value(d.codStatus)).toHaveTextContent(strings.codStatus.COLLECTED));
    expect(posts(api, 'delivery/delivered')[0]?.body).toEqual({});
    // Returning a delivered parcel is the owner's correction; settling is the next step.
    expect(buttons()).toEqual([v.move.RETURNED, v.settleCod]);
  });

  it('a failed delivery needs a reason; afterwards it can go out again or come back', async () => {
    const failed = withDelivery({ status: 'FAILED' }, { stage: 'DELIVERY_FAILED' });
    const { api } = setup(withDelivery({ status: 'DISPATCHED' }), (api) =>
      api.on('POST', `${PATH}/delivery/failed`, () => ({ status: 200, body: failed })),
    );
    await loadedCard();
    await userEvent.click(card().getByRole('button', { name: v.move.FAILED }));
    const form = await sheet(v.reasonSheet.failedTitle('NIM-0042'));
    await userEvent.click(form.getByRole('button', { name: v.move.FAILED }));
    expect(await form.findByText('Say why the delivery failed.')).toBeInTheDocument();
    expect(posts(api, 'delivery/failed')).toHaveLength(0);

    await userEvent.type(form.getByLabelText(v.reasonSheet.reason), 'Customer not at home');
    await userEvent.click(form.getByRole('button', { name: v.move.FAILED }));
    await waitFor(() => expect(posts(api, 'delivery/failed')).toHaveLength(1));
    expect(posts(api, 'delivery/failed')[0]?.body).toEqual({ reason: 'Customer not at home' });
    await waitFor(() => expect(buttons()).toEqual([v.redispatch, v.move.RETURNED]));
  });

  it('staff don’t see the owner-only return of a delivered parcel', async () => {
    setup(
      withDelivery(
        { status: 'DELIVERED', codStatus: 'SETTLED' },
        { orderStatus: 'COMPLETED', stage: 'COMPLETED' },
      ),
      () => {},
      'STAFF',
    );
    await loadedCard();
    expect(buttons()).toEqual([]);
  });
});

describe('settling COD (§7.7)', () => {
  const collected = () =>
    withDelivery(
      { status: 'DELIVERED', codStatus: 'COLLECTED' },
      { orderStatus: 'COMPLETED', stage: 'COMPLETED' },
    );

  it('records the payout with an Idempotency-Key and shows COD as settled', async () => {
    const settled = withDelivery(
      { status: 'DELIVERED', codStatus: 'SETTLED' },
      {
        orderStatus: 'COMPLETED',
        stage: 'COMPLETED',
        amountPaid: '2450.00',
        balanceDue: '0.00',
        paymentStatus: 'PAID',
      },
    );
    const { api } = setup(collected(), (api) =>
      api.on('POST', `${PATH}/cod/settle`, () => ({
        status: 200,
        body: {
          payment: {
            id: 'p1',
            type: 'PAYMENT',
            method: 'COD',
            amount: '2450.00',
            occurredAt: '2026-11-03T06:00:00.000Z',
            createdAt: '2026-11-03T06:00:00.000Z',
            refundOfPaymentId: null,
            reference: 'KB payout 7',
            notes: null,
            recordedBy: { id: 'u1', name: 'Nimali' },
          },
          order: settled,
        } satisfies PaymentRecorded,
      })),
    );
    await loadedCard();
    await userEvent.click(card().getByRole('button', { name: v.settleCod }));
    const form = await sheet(v.settleSheet.title);
    expect(form.getByText(v.settleSheet.body('LKR 2,450.00'))).toBeInTheDocument();
    expect(form.getByLabelText(v.settleSheet.date)).toHaveValue(localToday());
    await userEvent.type(form.getByLabelText(v.settleSheet.reference), 'KB payout 7');
    await userEvent.click(form.getByRole('button', { name: v.settleSheet.submit }));

    await waitFor(() => expect(value(d.codStatus)).toHaveTextContent(strings.codStatus.SETTLED));
    const [post] = posts(api, 'cod/settle') as [RecordedCall];
    expect(post.headers['Idempotency-Key']).toMatch(UUID);
    // Today is sent as "now": the server's clock.
    expect(post.body).toEqual({ reference: 'KB payout 7', notes: null });
    expect(buttons()).not.toContain(v.settleCod);
  });

  it('a date before the delivery is refused on the field; a retry reuses the key', async () => {
    let reply = 0;
    const { api } = setup(collected(), (api) =>
      api.on('POST', `${PATH}/cod/settle`, () =>
        reply++ === 0
          ? errorReply(
              422,
              'SETTLED_BEFORE_DELIVERY',
              'The courier can’t have paid you before the delivery.',
              {
                settledAt: 'The courier can’t have paid you before the delivery.',
              },
            )
          : errorReply(503, 'UNAVAILABLE', 'Try again.'),
      ),
    );
    await loadedCard();
    await userEvent.click(card().getByRole('button', { name: v.settleCod }));
    const form = await sheet(v.settleSheet.title);
    await userEvent.click(form.getByRole('button', { name: v.settleSheet.submit }));
    expect(
      await form.findAllByText('The courier can’t have paid you before the delivery.'),
    ).not.toHaveLength(0);

    await userEvent.click(form.getByRole('button', { name: v.settleSheet.submit }));
    await waitFor(() => expect(posts(api, 'cod/settle')).toHaveLength(2));
    const [first, second] = posts(api, 'cod/settle') as [RecordedCall, RecordedCall];
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
  });
});
