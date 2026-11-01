import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { createFakeApi, errorReply, memberMe, newcomerMe, TEST_REQUEST_ID } from '../../test/fake-api';
import { createFakeAuth, fakeSession } from '../../test/fake-auth';
import { renderApp } from '../../test/render-app';
import { toOnboardingRequest } from './OnboardingPage';

const s = strings.onboarding;
const field = (label: string) => screen.getByLabelText(label);
const preview = () => screen.getByTestId('prefix-preview');

function newcomer() {
  const api = createFakeApi({ me: newcomerMe() });
  const auth = createFakeAuth(fakeSession());
  return { api, auth };
}

describe('onboarding', () => {
  it('sends a signed-in user without a business to /onboarding', async () => {
    const { api, auth } = newcomer();
    const router = renderApp('/', auth, api);
    expect(await screen.findByRole('heading', { name: s.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/me' });
    expect(api.calls[0]?.headers.Authorization).toBe('Bearer test-access-token');
  });

  it('suggests a prefix from the business name and previews the order numbers', async () => {
    const { api, auth } = newcomer();
    renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    expect(field(s.orderPrefix)).toHaveValue('ORD');
    await userEvent.type(field(s.businessName), 'Nimali Fashions');
    expect(field(s.orderPrefix)).toHaveValue('NIM');
    expect(preview()).toHaveTextContent(s.prefixPreview('NIM-0001', 'NIM-0002'));
  });

  it('stops suggesting once the seller types their own prefix', async () => {
    const { api, auth } = newcomer();
    renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    await userEvent.clear(field(s.orderPrefix));
    await userEvent.type(field(s.orderPrefix), 'nf');
    await userEvent.type(field(s.businessName), 'Nimali Fashions');
    expect(field(s.orderPrefix)).toHaveValue('nf'); // shown upper-case; sent upper-case
    expect(preview()).toHaveTextContent('NF-0001');
  });

  it('creates the business with the Bearer token and lands on the empty dashboard', async () => {
    const { api, auth } = newcomer();
    api.on('POST', '/onboarding', () => ({ status: 201, body: memberMe({ name: 'Nimali Fashions' }) }));
    const router = renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    await userEvent.type(field(s.businessName), '  Nimali Fashions ');
    await userEvent.type(field(s.contactPhone), '077 123 4567');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));

    expect(await screen.findByRole('heading', { name: strings.dashboard.title })).toBeInTheDocument();
    expect(screen.getByText(strings.dashboard.empty)).toBeInTheDocument();
    // Shown in the desktop sidebar and the mobile top bar (CSS shows one of them).
    expect(screen.getAllByText('Nimali Fashions').length).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe('/');

    const post = api.calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/onboarding');
    expect(post?.headers.Authorization).toBe('Bearer test-access-token');
    expect(post?.body).toEqual({
      businessName: 'Nimali Fashions',
      contactPhone: '077 123 4567',
      orderPrefix: 'NIM',
    });
    // The response replaced GET /me in the cache: no second /me request was needed.
    expect(api.calls.filter((call) => call.path === '/me')).toHaveLength(1);
  });

  it('checks the form with the shared rules before sending anything', async () => {
    const { api, auth } = newcomer();
    renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    await userEvent.clear(field(s.orderPrefix));
    await userEvent.type(field(s.orderPrefix), 'N-1');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    expect(await screen.findByText('Enter your business name.')).toBeInTheDocument();
    expect(screen.getByText('Use 2 to 6 letters or numbers, for example NIM.')).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows field errors from the server next to the field', async () => {
    const { api, auth } = newcomer();
    api.on('POST', '/onboarding', () =>
      errorReply(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
        businessName: 'Use at most 100 characters.',
      }),
    );
    renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    await userEvent.type(field(s.businessName), 'Nimali Fashions');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    expect(await screen.findByText('Use at most 100 characters.')).toBeInTheDocument();
    expect(field(s.businessName)).toHaveAttribute('aria-invalid', 'true');
    expect(field(s.businessName)).toHaveValue('Nimali Fashions'); // input kept (US-020)
  });

  it('explains other failures with a reference number and keeps the input', async () => {
    const { api, auth } = newcomer();
    const message = 'This email address is already linked to another account. Please contact support.';
    api.on('POST', '/onboarding', () => errorReply(409, 'EMAIL_IN_USE', message));
    renderApp('/onboarding', auth, api);
    await screen.findByRole('heading', { name: s.title });
    await userEvent.type(field(s.businessName), 'Nimali Fashions');
    await userEvent.click(screen.getByRole('button', { name: s.submit }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent(strings.api.reference(TEST_REQUEST_ID));
    expect(field(s.businessName)).toHaveValue('Nimali Fashions');
  });

  it('sends a seller who already has a business from /onboarding to the dashboard', async () => {
    const router = renderApp('/onboarding', createFakeAuth(fakeSession()), createFakeApi());
    expect(await screen.findByRole('heading', { name: strings.dashboard.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows an error with Retry when the account cannot be loaded, then recovers', async () => {
    const api = createFakeApi();
    let failures = 0;
    api.on('GET', '/me', () => {
      failures += 1;
      return failures === 1
        ? errorReply(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Please contact support.')
        : { status: 200, body: memberMe() };
    });
    renderApp('/', createFakeAuth(fakeSession()), api);
    expect(await screen.findByRole('heading', { name: strings.account.loadFailedTitle })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This account has been disabled.');
    expect(screen.getByRole('button', { name: strings.layout.logOut })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.account.retry }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: strings.dashboard.title })).toBeInTheDocument(),
    );
  });
});

describe('toOnboardingRequest', () => {
  it('leaves out an empty phone and keeps the rest', () => {
    expect(toOnboardingRequest({ businessName: 'A B', contactPhone: null, orderPrefix: 'AB' })).toEqual({
      businessName: 'A B',
      orderPrefix: 'AB',
    });
  });
});
