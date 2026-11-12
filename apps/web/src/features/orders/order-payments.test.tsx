// Payments on the order page (docs/DEVELOPMENT.md §6.5, §7.7, task D5), on the real routes and API
// client over a fake fetch, so each test checks exactly what the app sends. Fake data only.
import type { OrderDetail, Page, PaymentRecorded, PaymentView } from '@ssom/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi, RecordedCall } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const d = strings.orders.detail;
const p = strings.orders.payments;
const s = p.sheet;
const ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const PAYMENT_ID = '9d4c6f5b-7e80-4192-bdae-3f4a5b6c7d8e';
const PATH = `/orders/${ID}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A NEW cash pickup of 3450.00 with 1000.00 paid. */
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    orderNumber: 'NIM-0042',
    orderStatus: 'NEW',
    paymentStatus: 'PARTIALLY_PAID',
    stage: 'NEW',
    sourceChannel: 'WHATSAPP',
    sourceNote: null,
    fulfilmentType: 'PICKUP',
    paymentMethod: 'CASH',
    customer: { id: null, name: 'Walk-in customer', phone: null },
    items: [
      { id: 'i1', productId: null, name: 'Silk Saree', sku: null, quantity: 1, unitPrice: '3450.00', lineTotal: '3450.00' },
    ],
    subtotal: '3450.00',
    discountAmount: '0.00',
    deliveryFee: '0.00',
    totalAmount: '3450.00',
    amountPaid: '1000.00',
    amountRefunded: '0.00',
    balanceDue: '2450.00',
    refundOwed: '0.00',
    delivery: null,
    notes: null,
    createdAt: '2026-11-01T06:00:00.000Z',
    updatedAt: '2026-11-01T06:00:00.000Z',
    ...overrides,
  } as OrderDetail;
}

function payment(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: PAYMENT_ID,
    type: 'PAYMENT',
    method: 'BANK_TRANSFER',
    amount: '1000.00',
    occurredAt: '2026-11-01T06:00:00.000Z',
    createdAt: '2026-11-01T06:00:00.000Z',
    refundOfPaymentId: null,
    reference: 'BOC 123',
    notes: null,
    recordedBy: { id: 'u1', name: 'Nimali' },
    ...overrides,
  };
}

const page = (items: PaymentView[]): Page<PaymentView> => ({ items, page: 1, pageSize: 25, total: items.length });

function setup(current: OrderDetail, history: PaymentView[], configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  api.on('GET', PATH, () => ({ status: 200, body: current }));
  api.on('GET', `${PATH}/events`, () => ({ status: 200, body: { items: [], page: 1, pageSize: 25, total: 0 } }));
  api.on('GET', `${PATH}/payments`, () => ({ status: 200, body: page(history) }));
  configure(api);
  renderApp(PATH, createFakeAuth(fakeSession()), api);
  return { api };
}

const paymentSection = () => within(screen.getByRole('region', { name: d.sections.payment }));
/** The payment section once the order has loaded (the page shows "Loading…" first). */
const loadedPaymentSection = async () =>
  within(await screen.findByRole('region', { name: d.sections.payment }));
const posts = (api: FakeApi) =>
  api.calls.filter((call) => call.method === 'POST' && call.path === `${PATH}/payments`);
const sheet = async (title: string) => within(await screen.findByRole('dialog', { name: title }));

describe('payment summary and history (§6.5)', () => {
  it('shows total, paid, refunded and balance, and every record with method, who and reference', async () => {
    setup(order({ amountRefunded: '200.00', balanceDue: '2650.00', paymentStatus: 'PARTIALLY_REFUNDED' }), [
      payment(),
      payment({ id: 'r1', type: 'REFUND', method: 'CASH', amount: '200.00', reference: null, refundOfPaymentId: PAYMENT_ID, notes: 'Correction' }),
    ]);
    const history = within(await screen.findByRole('list', { name: p.history }));
    const [paid, refunded] = history.getAllByRole('listitem');
    expect(paid).toHaveTextContent(strings.paymentType.PAYMENT);
    expect(paid).toHaveTextContent(p.line(strings.paymentMethod.BANK_TRANSFER, 'Nimali'));
    expect(paid).toHaveTextContent(p.reference('BOC 123'));
    expect(paid).toHaveTextContent('LKR 1,000.00');
    expect(refunded).toHaveTextContent(strings.paymentType.REFUND);
    expect(refunded).toHaveTextContent('−LKR 200.00');
    expect(refunded).toHaveTextContent(p.refundOf);
    expect(refunded).toHaveTextContent('Correction');

    const summary = paymentSection();
    expect(summary.getByText(d.refunded).nextElementSibling).toHaveTextContent('LKR 200.00');
    expect(summary.getByText(d.balance).nextElementSibling).toHaveTextContent('LKR 2,650.00');
  });

  it('says when nothing has been paid', async () => {
    setup(order({ amountPaid: '0.00', balanceDue: '3450.00', paymentStatus: 'UNPAID' }), []);
    expect(await screen.findByText(p.empty)).toBeInTheDocument();
  });
});

describe('recording a payment (§7.7)', () => {
  it('suggests the balance, sends one request with an Idempotency-Key, and updates the summary', async () => {
    const paid = order({ amountPaid: '3450.00', balanceDue: '0.00', paymentStatus: 'PAID' });
    const { api } = setup(order(), [payment()], (api) =>
      api.on('POST', `${PATH}/payments`, () => ({
        status: 201,
        body: { payment: payment({ id: 'p2', amount: '2450.00' }), order: paid } satisfies PaymentRecorded,
      })),
    );
    await userEvent.click(await (await loadedPaymentSection()).findByRole('button', { name: p.recordPayment }));
    const form = await sheet(s.paymentTitle);
    expect(form.getByLabelText(s.amount)).toHaveValue('2450.00');
    // COD can't be chosen by hand: it is recorded by settling it.
    expect(form.queryByRole('option', { name: strings.paymentMethod.COD })).not.toBeInTheDocument();
    await userEvent.selectOptions(form.getByLabelText(s.method), 'BANK_TRANSFER');
    await userEvent.type(form.getByLabelText(s.reference), 'BOC 456');
    await userEvent.click(form.getByRole('button', { name: s.submitPayment }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [post] = posts(api) as [RecordedCall];
    expect(post.headers['Idempotency-Key']).toMatch(UUID);
    expect(post.body).toEqual({ type: 'PAYMENT', method: 'BANK_TRANSFER', amount: '2450.00', reference: 'BOC 456', notes: null });
    // Paid in full: the summary says so and there is nothing left to record.
    await waitFor(() =>
      expect(paymentSection().getByText(d.balance).nextElementSibling).toHaveTextContent('LKR 0.00'),
    );
    expect(paymentSection().queryByRole('button', { name: p.recordPayment })).not.toBeInTheDocument();
    // The history is loaded again to show the new record.
    expect(api.calls.filter((call) => call.path.startsWith(`${PATH}/payments`) && call.method === 'GET').length).toBeGreaterThan(1);
  });

  it('a backdated payment is sent with its day', async () => {
    const { api } = setup(order(), [], (api) =>
      api.on('POST', `${PATH}/payments`, () => ({ status: 201, body: { payment: payment(), order: order() } })),
    );
    await userEvent.click(await (await loadedPaymentSection()).findByRole('button', { name: p.recordPayment }));
    const form = await sheet(s.paymentTitle);
    await userEvent.selectOptions(form.getByLabelText(s.method), 'CASH');
    const day = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    fireEvent.change(form.getByLabelText(s.date), { target: { value: iso } });
    await userEvent.click(form.getByRole('button', { name: s.submitPayment }));
    await waitFor(() => expect(posts(api)).toHaveLength(1));
    const sent = (posts(api)[0]?.body as { occurredAt: string }).occurredAt;
    expect(new Date(sent).getDate()).toBe(day.getDate());
  });

  it('a refused payment keeps the form, shows why on the field, and a retry reuses the key', async () => {
    let reply = 0;
    const { api } = setup(order(), [], (api) =>
      api.on('POST', `${PATH}/payments`, () =>
        reply++ === 0
          ? errorReply(422, 'PAYMENT_EXCEEDS_BALANCE', 'This is more than the balance due (2450.00).', {
              amount: 'This is more than the balance due (2450.00).',
            })
          : { status: 201, body: { payment: payment(), order: order() } },
      ),
    );
    await userEvent.click(await (await loadedPaymentSection()).findByRole('button', { name: p.recordPayment }));
    const form = await sheet(s.paymentTitle);
    await userEvent.clear(form.getByLabelText(s.amount));
    await userEvent.type(form.getByLabelText(s.amount), '9999');
    await userEvent.selectOptions(form.getByLabelText(s.method), 'CASH');
    await userEvent.click(form.getByRole('button', { name: s.submitPayment }));

    expect(await form.findAllByText('This is more than the balance due (2450.00).')).not.toHaveLength(0);
    expect(form.getByLabelText(s.amount)).toHaveValue('9999');
    await userEvent.click(form.getByRole('button', { name: s.submitPayment }));
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    const [first, second] = posts(api) as [RecordedCall, RecordedCall];
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
  });
});

describe('refunds (§7.7)', () => {
  it('after a cancel, prompts for the refund owed and records it, linked to the payment', async () => {
    const cancelled = order({ orderStatus: 'CANCELLED', stage: 'CANCELLED', balanceDue: '0.00', refundOwed: '1000.00' });
    const refunded = order({
      orderStatus: 'CANCELLED',
      stage: 'CANCELLED',
      balanceDue: '0.00',
      amountRefunded: '1000.00',
      refundOwed: '0.00',
      paymentStatus: 'REFUNDED',
    });
    const { api } = setup(cancelled, [payment()], (api) =>
      api.on('POST', `${PATH}/payments`, () => ({
        status: 201,
        body: { payment: payment({ id: 'r1', type: 'REFUND' }), order: refunded },
      })),
    );
    expect(await screen.findByText(p.refundPromptTitle('LKR 1,000.00'))).toBeInTheDocument();
    // A closed order takes no payments.
    expect(paymentSection().queryByRole('button', { name: p.recordPayment })).not.toBeInTheDocument();

    await userEvent.click(paymentSection().getByRole('button', { name: p.recordRefund }));
    const form = await sheet(s.refundTitle);
    expect(form.getByLabelText(s.amount)).toHaveValue('1000.00');
    await userEvent.selectOptions(form.getByLabelText(s.method), 'CASH');
    await userEvent.selectOptions(form.getByLabelText(s.refundOf), PAYMENT_ID);
    await userEvent.click(form.getByRole('button', { name: s.submitRefund }));

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.body).toMatchObject({
      type: 'REFUND',
      method: 'CASH',
      amount: '1000.00',
      refundOfPaymentId: PAYMENT_ID,
    });
    await waitFor(() => expect(screen.queryByText(p.refundPromptTitle('LKR 1,000.00'))).not.toBeInTheDocument());
  });

  it('offers only what can succeed: no refund before any payment, no payment on a closed order', async () => {
    setup(order({ amountPaid: '0.00', balanceDue: '3450.00', paymentStatus: 'UNPAID' }), []);
    expect(await (await loadedPaymentSection()).findByRole('button', { name: p.recordPayment })).toBeInTheDocument();
    expect(paymentSection().queryByRole('button', { name: p.recordRefund })).not.toBeInTheDocument();
  });

  it('a cancelled order with nothing paid offers neither', async () => {
    setup(order({ orderStatus: 'CANCELLED', stage: 'CANCELLED', amountPaid: '0.00', balanceDue: '0.00', paymentStatus: 'UNPAID' }), []);
    expect(await screen.findByText(p.empty)).toBeInTheDocument();
    expect(paymentSection().queryAllByRole('button')).toHaveLength(0);
  });
});
