import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { strings } from '../lib/strings';
import { AppProviders } from './providers';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('routes', () => {
  it('shows the dashboard at /', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: strings.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for unknown paths', async () => {
    renderAt('/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: strings.notFound.title }),
    ).toBeInTheDocument();
  });

  it('links from the not-found page back to the dashboard', async () => {
    const router = renderAt('/no-such-page');
    await userEvent.click(await screen.findByRole('link', { name: strings.notFound.backHome }));
    expect(router.state.location.pathname).toBe('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: strings.dashboard.title }),
    ).toBeInTheDocument();
  });
});
