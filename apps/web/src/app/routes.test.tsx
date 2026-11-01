import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../lib/strings';
import { createFakeAuth, fakeSession } from '../test/fake-auth';
import { renderApp } from '../test/render-app';

const dashboardHeading = () =>
  screen.findByRole('heading', { level: 1, name: strings.dashboard.title });
const loginHeading = () =>
  screen.findByRole('heading', { level: 1, name: strings.auth.login.title });

describe('routes (signed in)', () => {
  it('shows the dashboard at /', async () => {
    renderApp('/', createFakeAuth(fakeSession()));
    expect(await dashboardHeading()).toBeInTheDocument();
  });

  it('shows a not-found page for unknown paths', async () => {
    renderApp('/no-such-page', createFakeAuth(fakeSession()));
    expect(
      await screen.findByRole('heading', { level: 1, name: strings.notFound.title }),
    ).toBeInTheDocument();
  });

  it('links from the not-found page back to the dashboard', async () => {
    const router = renderApp('/no-such-page', createFakeAuth(fakeSession()));
    await userEvent.click(await screen.findByRole('link', { name: strings.notFound.backHome }));
    expect(router.state.location.pathname).toBe('/');
    expect(await dashboardHeading()).toBeInTheDocument();
  });

  it.each(['/login', '/signup', '/forgot-password'])('skips %s and goes to the app', async (path) => {
    const router = renderApp(path, createFakeAuth(fakeSession()));
    expect(await dashboardHeading()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('protected routes (signed out)', () => {
  it.each(['/', '/no-such-page', '/orders?status=READY'])('redirects %s to the login page', async (path) => {
    const router = renderApp(path, createFakeAuth(null));
    expect(await loginHeading()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('heading', { name: strings.dashboard.title })).not.toBeInTheDocument();
  });

  it('shows a loading state, not the page, while the session is being read', async () => {
    const auth = createFakeAuth(null);
    auth.getSession.mockReturnValueOnce(new Promise(() => undefined)); // never answers
    renderApp('/', auth);
    expect(await screen.findByRole('status')).toHaveTextContent(strings.common.loading);
    expect(screen.queryByRole('heading', { name: strings.dashboard.title })).not.toBeInTheDocument();
  });

  it('returns to the page the seller asked for after logging in', async () => {
    const auth = createFakeAuth(null);
    const router = renderApp('/no-such-page?x=1', auth);
    await loginHeading();
    await userEvent.type(screen.getByLabelText(strings.auth.fields.email), 'seller@example.test');
    await userEvent.type(screen.getByLabelText(strings.auth.fields.password), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: strings.auth.login.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/no-such-page'));
    expect(router.state.location.search).toBe('?x=1');
  });

  it('sends the seller to log in when the session ends elsewhere (expired or revoked)', async () => {
    const auth = createFakeAuth(fakeSession());
    const router = renderApp('/', auth);
    await dashboardHeading();
    act(() => auth.emit('SIGNED_OUT', null));
    expect(await loginHeading()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('log out', () => {
  it('ends the session on this device only and returns to the login page', async () => {
    const auth = createFakeAuth(fakeSession());
    const router = renderApp('/', auth);
    await userEvent.click(await screen.findByRole('button', { name: strings.layout.logOut }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await loginHeading()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('stays signed in and says so when logging out fails', async () => {
    const auth = createFakeAuth(fakeSession());
    auth.signOut.mockResolvedValueOnce({ error: new Error('network') as never });
    renderApp('/', auth);
    await userEvent.click(await screen.findByRole('button', { name: strings.layout.logOut }));
    expect(await screen.findByRole('alert')).toHaveTextContent(strings.layout.logOutFailed);
    expect(await dashboardHeading()).toBeInTheDocument();
  });
});
