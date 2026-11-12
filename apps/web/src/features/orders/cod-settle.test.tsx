// "COD to settle" (docs/DEVELOPMENT.md §2.2, §9.4, task D8): one courier remittance, several orders,
// one request. On the real routes and API client over a fake fetch. Fake data only.
import type { CodAwaitingItem, CodBulkSettled, Page } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi, RecordedCall } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const c = strings.orders.cod;
const f = strings.orders.delivery.settleSheet;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID = (n: number) => `0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0${n}`;

function item(n: number, courierName: string | null, codAmount: string): CodAwaitingItem {
  return {
    orderId: ID(n),
    orderNumber: `NIM-000${n}`,
    recipientName: `Customer ${n}`,
    courierName,
    trackingNumber: `TR${n}`,
    codAmount,
    deliveredAt: '2026-11-10T06:00:00.000Z',
  };
}

const ITEMS = [item(1, 'Domex', '1000.00'), item(2, 'Domex', '850.00'), item(3, 'Koombiyo', '2000.00')];
const page = (items: CodAwaitingItem[]): Page<CodAwaitingItem> => ({ items, page: 1, pageSize: 50, total: items.length });

function setup(items: CodAwaitingItem[], configure: (api: FakeApi) => void = () => {}) {
  const api = createFakeApi();
  let current = items;
  api.on('GET', '/cod/awaiting', () => ({ status: 200, body: page(current) }));
  configure(api);
  renderApp('/cod', createFakeAuth(fakeSession()), api);
  return { api, settle: (ids: string[]) => (current = current.filter((row) => !ids.includes(row.orderId))) };
}

const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST' && call.path === '/cod/settle');
const box = (n: number) => screen.getByLabelText(c.row(`NIM-000${n}`, `Customer ${n}`));
const sheet = async () => within(await screen.findByRole('dialog', { name: c.sheet.title }));

describe('COD to settle (§2.2)', () => {
  it('shows one courier at a time, with amounts, and totals what is ticked', async () => {
    setup(ITEMS);
    expect(await screen.findByRole('heading', { level: 2, name: 'Domex' })).toBeInTheDocument();
    const list = within(screen.getByRole('list', { name: c.listLabel }));
    expect(list.getAllByRole('listitem')).toHaveLength(2);
    expect(list.getByText('LKR 1,000.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: c.settle })).toBeDisabled();

    await userEvent.click(box(1));
    expect(screen.getByText(c.selected(1, 'LKR 1,000.00'))).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(c.selectAll));
    expect(screen.getByText(c.selected(2, 'LKR 1,850.00'))).toBeInTheDocument();

    // Another courier is another remittance: the choice starts over.
    await userEvent.selectOptions(screen.getByLabelText(c.courier), 'Koombiyo');
    expect(screen.getByRole('heading', { level: 2, name: 'Koombiyo' })).toBeInTheDocument();
    expect(screen.getByText(c.selected(0, 'LKR 0.00'))).toBeInTheDocument();
  });

  it('settles the ticked orders in one request with an Idempotency-Key, then they leave the list', async () => {
    const result: CodBulkSettled = {
      settled: [
        { orderId: ID(1), orderNumber: 'NIM-0001', paymentId: 'p1', amount: '1000.00' },
        { orderId: ID(2), orderNumber: 'NIM-0002', paymentId: 'p2', amount: '850.00' },
      ],
      totalAmount: '1850.00',
    };
    const fake = setup(ITEMS, (api) =>
      api.on('POST', '/cod/settle', () => {
        fake.settle([ID(1), ID(2)]);
        return { status: 200, body: result };
      }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Domex' });
    await userEvent.click(screen.getByLabelText(c.selectAll));
    await userEvent.click(screen.getByRole('button', { name: c.settle }));
    const form = await sheet();
    expect(form.getByText(c.sheet.body(2, 'Domex', 'LKR 1,850.00'))).toBeInTheDocument();
    await userEvent.type(form.getByLabelText(f.reference), 'Domex remit 12');
    await userEvent.click(form.getByRole('button', { name: c.sheet.submit }));

    expect(await screen.findByText(c.done(2, 'LKR 1,850.00'))).toBeInTheDocument();
    const [post] = posts(fake.api) as [RecordedCall];
    expect(post.headers['Idempotency-Key']).toMatch(UUID);
    expect(post.body).toEqual({ orderIds: [ID(1), ID(2)], reference: 'Domex remit 12', notes: null });
    // Only Koombiyo is left.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Koombiyo' })).toBeInTheDocument(),
    );
  });

  it('a refused remittance keeps the sheet open with the reason; a retry reuses the key', async () => {
    let reply = 0;
    const { api } = setup(ITEMS, (api) =>
      api.on('POST', '/cod/settle', () =>
        reply++ === 0
          ? errorReply(422, 'COD_NOT_COLLECTED', 'NIM-0002: This cash on delivery has already been settled.')
          : errorReply(503, 'UNAVAILABLE', 'Try again.'),
      ),
    );
    await screen.findByRole('heading', { level: 2, name: 'Domex' });
    await userEvent.click(box(1));
    await userEvent.click(box(2));
    await userEvent.click(screen.getByRole('button', { name: c.settle }));
    const form = await sheet();
    await userEvent.click(form.getByRole('button', { name: c.sheet.submit }));
    expect(await form.findByText('NIM-0002: This cash on delivery has already been settled.')).toBeInTheDocument();

    await userEvent.click(form.getByRole('button', { name: c.sheet.submit }));
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    const [first, second] = posts(api) as [RecordedCall, RecordedCall];
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
  });

  it('says when there is nothing to settle', async () => {
    setup([]);
    expect(await screen.findByText(c.emptyTitle)).toBeInTheDocument();
  });
});
