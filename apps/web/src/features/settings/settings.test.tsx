// The settings screen (docs/DEVELOPMENT.md §6.8, task E5), on the real routes and API client over a
// fake fetch, with a fake Supabase Auth client. Fake data only.
import type { BusinessView } from '@ssom/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { TEST_BUSINESS_ID, createFakeApi, errorReply, memberMe } from '../../test/fake-api';
import type { FakeApi } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';

const s = strings.settings;
const b = s.business;
const f = strings.auth.fields;

const PROFILE: BusinessView = {
  id: TEST_BUSINESS_ID,
  name: 'Nimali Fashions',
  contactPhone: '077 123 4567',
  orderPrefix: 'NIM',
  currency: 'LKR',
  timezone: 'Asia/Colombo',
  defaultDeliveryFee: '350.00',
  nextOrderSequence: 42,
};

function setup(options: { role?: 'OWNER' | 'STAFF'; configure?: (api: FakeApi) => void } = {}) {
  const api = createFakeApi({ me: { ...memberMe(), role: options.role ?? 'OWNER' } });
  api.on('GET', '/business', () => ({ status: 200, body: PROFILE }));
  options.configure?.(api);
  const auth = createFakeAuth(fakeSession());
  renderApp('/settings', auth, api);
  return { api, auth };
}

const business = async () => within(await screen.findByRole('region', { name: b.title }));
const preview = () => screen.getByTestId('prefix-preview');

describe('business settings (§6.8)', () => {
  it('shows the profile, with the next order number as a live preview', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: s.title })).toBeInTheDocument();
    const form = await business();
    expect(await form.findByLabelText(b.name)).toHaveValue('Nimali Fashions');
    expect(form.getByLabelText(b.contactPhone)).toHaveValue('077 123 4567');
    expect(form.getByLabelText(b.defaultDeliveryFee)).toHaveValue('350.00');
    expect(form.getByLabelText(b.timezone)).toHaveValue('Asia/Colombo');
    expect(form.getByText(b.currencyNote('LKR'))).toBeInTheDocument();
    expect(preview()).toHaveTextContent(b.prefixPreview('NIM-0042'));

    const prefix = form.getByLabelText(b.orderPrefix);
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'abc');
    expect(preview()).toHaveTextContent(b.prefixPreview('ABC-0042'));
    await userEvent.type(prefix, '!');
    expect(preview()).toHaveTextContent('');
  });

  it('saves the profile, then reads /me again so the whole app has the new values', async () => {
    let saved: unknown;
    const { api } = setup({
      configure: (fake) =>
        fake.on('PATCH', '/business', (call) => {
          saved = call.body;
          return { status: 200, body: { ...PROFILE, orderPrefix: 'ABC', contactPhone: null } };
        }),
    });
    const form = await business();
    const prefix = await form.findByLabelText(b.orderPrefix);
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'abc');
    await userEvent.clear(form.getByLabelText(b.contactPhone));
    const meCalls = api.calls.filter((call) => call.path === '/me').length;
    await userEvent.click(form.getByRole('button', { name: b.save }));

    expect(await form.findByText(b.saved)).toBeInTheDocument();
    expect(saved).toEqual({
      name: 'Nimali Fashions',
      contactPhone: null,
      orderPrefix: 'ABC',
      defaultDeliveryFee: '350.00',
      timezone: 'Asia/Colombo',
    });
    await waitFor(() =>
      expect(api.calls.filter((call) => call.path === '/me').length).toBeGreaterThan(meCalls),
    );
  });

  it('checks the fields before sending, and shows the API’s field errors', async () => {
    const { api } = setup({
      configure: (fake) =>
        fake.on('PATCH', '/business', () =>
          errorReply(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
            timezone: 'Choose a time zone from the list.',
          }),
        ),
    });
    const form = await business();
    const fee = await form.findByLabelText(b.defaultDeliveryFee);
    await userEvent.clear(fee);
    await userEvent.type(fee, '-5');
    await userEvent.click(form.getByRole('button', { name: b.save }));
    expect(
      await form.findByText('Enter an amount from 0 to 99,999,999.99, with at most 2 decimals.'),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === 'PATCH')).toBe(false);

    await userEvent.clear(fee);
    await userEvent.type(fee, '400');
    await userEvent.click(form.getByRole('button', { name: b.save }));
    expect(await form.findByText('Choose a time zone from the list.')).toBeInTheDocument();
  });

  it('staff see the settings but can’t change them', async () => {
    setup({ role: 'STAFF' });
    const form = await business();
    expect(await form.findByText(b.ownerOnly)).toBeInTheDocument();
    expect(form.getByLabelText(b.name)).toBeDisabled();
    expect(form.queryByRole('button', { name: b.save })).not.toBeInTheDocument();
  });
});

describe('account (§6.8)', () => {
  it('changes the password through Supabase Auth, after checking the two match', async () => {
    const { auth } = setup();
    const card = within(await screen.findByRole('region', { name: s.password.title }));
    await userEvent.type(card.getByLabelText(f.newPassword), 'a-new-password');
    await userEvent.type(card.getByLabelText(f.confirmPassword), 'something-else');
    await userEvent.click(card.getByRole('button', { name: s.password.save }));
    expect(await card.findByText(strings.auth.validation.passwordsDontMatch)).toBeInTheDocument();
    expect(auth.updateUser).not.toHaveBeenCalled();

    await userEvent.clear(card.getByLabelText(f.confirmPassword));
    await userEvent.type(card.getByLabelText(f.confirmPassword), 'a-new-password');
    await userEvent.click(card.getByRole('button', { name: s.password.save }));
    expect(await card.findByText(s.password.changed)).toBeInTheDocument();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-password' });
  });

  it('signs out of all devices after a confirmation', async () => {
    const { auth } = setup();
    const card = within(await screen.findByRole('region', { name: s.signOutAll.title }));
    await userEvent.click(card.getByRole('button', { name: s.signOutAll.start }));
    expect(auth.signOut).not.toHaveBeenCalled();
    await userEvent.click(card.getByRole('button', { name: s.signOutAll.confirm }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('explains export and account closure, and lists the message templates', async () => {
    setup();
    const data = within(await screen.findByRole('region', { name: s.data.title }));
    expect(data.getByRole('link', { name: s.data.exportLink })).toHaveAttribute('href', '/orders');
    expect(data.getByText(s.data.closureBody)).toBeInTheDocument();
    const templates = within(screen.getByRole('region', { name: s.templates.title }));
    expect(templates.getByText(strings.orders.messages.titles.confirmation)).toBeInTheDocument();
  });
});
