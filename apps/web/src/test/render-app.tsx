// Renders the real route table at a path, with a fake auth client.
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import type { InitialEntry } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '../app/providers';
import { routes } from '../app/routes';
import type { FakeAuth } from './fake-auth';

export function renderApp(entry: InitialEntry, auth: FakeAuth) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <AppProviders auth={auth.client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
