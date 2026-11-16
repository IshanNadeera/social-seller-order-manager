// The order page's message card (docs/DEVELOPMENT.md §2.1, §6.5, task D7): read-only text and a
// Copy button that only writes to the clipboard. Fake data only.
import type { OrderDetail } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const d = strings.orders.detail;
const m = strings.orders.messages;
const ID = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const PATH = `/orders/${ID}`;

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
      {
        id: 'i1',
        productId: null,
        name: 'Silk Saree',
        sku: null,
        quantity: 1,
        unitPrice: '3450.00',
        lineTotal: '3450.00',
      },
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
  };
}

function setup(current: OrderDetail) {
  const api = createFakeApi();
  const empty = { status: 200, body: { items: [], page: 1, pageSize: 25, total: 0 } };
  api.on('GET', PATH, () => ({ status: 200, body: current }));
  api.on('GET', `${PATH}/events`, () => empty);
  api.on('GET', `${PATH}/payments`, () => empty);
  renderApp(PATH, createFakeAuth(fakeSession()), api);
  return { api };
}

const card = async () => within(await screen.findByRole('region', { name: d.sections.messages }));

describe('message templates on the order page (§6.5)', () => {
  it('shows read-only messages filled from the order', async () => {
    setup(order());
    const messages = await card();
    const confirmation = messages.getByLabelText<HTMLTextAreaElement>(m.titles.confirmation);
    expect(confirmation).toHaveAttribute('readonly');
    expect(confirmation.value).toContain('Thank you for your order NIM-0042 from Nimali Fashions.');
    expect(messages.getByLabelText<HTMLTextAreaElement>(m.titles.paymentReminder).value).toContain(
      'LKR 2,450.00 is still to be paid',
    );
  });

  it('Copy puts the text on the clipboard and sends nothing to the API', async () => {
    const user = userEvent.setup();
    const { api } = setup(order());
    const messages = await card();
    const before = api.calls.length;
    await user.click(messages.getByRole('button', { name: m.copyLabel(m.titles.confirmation) }));

    await waitFor(() =>
      expect(messages.getByRole('status')).toHaveTextContent(m.copiedStatus(m.titles.confirmation)),
    );
    expect(await navigator.clipboard.readText()).toBe(
      (messages.getByLabelText(m.titles.confirmation) as HTMLTextAreaElement).value,
    );
    expect(api.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('a cancelled order offers no messages', async () => {
    setup(
      order({
        orderStatus: 'CANCELLED',
        stage: 'CANCELLED',
        balanceDue: '0.00',
        refundOwed: '1000.00',
      }),
    );
    expect((await card()).getByText(m.none)).toBeInTheDocument();
  });
});
