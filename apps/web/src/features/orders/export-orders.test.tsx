// "Export CSV" on the orders list (docs/DEVELOPMENT.md §9.4, §11.4, task E4), on the real routes
// and API client over a fake fetch. Fake data only.
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply } from '../../test/fake-api';
import type { FakeApi, FakeReply } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.orders.list;
const CSV = '﻿Order number\r\nNIM-0001\r\n';
const file: FakeReply = {
  status: 200,
  text: { content: CSV, contentType: 'text/csv; charset=utf-8' },
};

let saved: { name: string; blob: Blob }[] = [];

beforeEach(() => {
  saved = [];
  // jsdom has no downloads (nor object URLs): record what would be saved instead.
  if (!('createObjectURL' in URL)) {
    Object.assign(URL, { createObjectURL: () => '', revokeObjectURL: () => undefined });
  }
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (blob !== undefined) saved.push({ name: this.download, blob });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(path: string, reply: () => FakeReply = () => file) {
  const api = createFakeApi();
  api.on('GET', '/orders', () => ({
    status: 200,
    body: { items: [], page: 1, pageSize: 25, total: 0 },
  }));
  api.on('GET', '/exports/orders.csv', reply);
  renderApp(path, createFakeAuth(fakeSession()), api);
  return api;
}

const exports = (api: FakeApi) =>
  api.calls.filter((call) => call.path.startsWith('/exports/orders.csv')).map((call) => call.path);

describe('Export CSV (§9.4)', () => {
  it('downloads every order when nothing is filtered', async () => {
    const api = setup('/orders');
    expect(await screen.findByText(s.exportAll)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.exportCsv }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(exports(api)).toEqual(['/exports/orders.csv']);
    expect(saved[0]?.name).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
    // Byte for byte as plain numbers, byte-order mark included (Blob.text() would drop it, and
    // typed arrays from jsdom and Node never compare equal).
    const bytes = await saved[0]?.blob.arrayBuffer();
    expect(Array.from(new Uint8Array(bytes ?? new ArrayBuffer(0)))).toEqual(
      Array.from(new TextEncoder().encode(CSV)),
    );
    expect(screen.getByRole('status')).toHaveTextContent(s.exported);
  });

  it('sends the list’s search and filters, not its page', async () => {
    const api = setup('/orders?q=NIM&orderStatus=READY&from=2026-10-01&to=2026-10-31&page=3');
    expect(await screen.findByText(s.exportFiltered)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.exportCsv }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(exports(api)).toEqual([
      '/exports/orders.csv?q=NIM&orderStatus=READY&from=2026-10-01&to=2026-10-31',
    ]);
  });

  it('shows the API’s reason when it refuses, and saves nothing', async () => {
    setup('/orders', () =>
      errorReply(
        429,
        'EXPORT_RATE_LIMITED',
        'You can export 10 times an hour. Please try again in 50 minutes.',
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: s.exportCsv }));
    expect(await screen.findByText(s.exportFailed)).toBeInTheDocument();
    expect(
      screen.getByText('You can export 10 times an hour. Please try again in 50 minutes.'),
    ).toBeInTheDocument();
    expect(saved).toEqual([]);
  });
});
