// Renders the real route table at a path, with a fake auth client and the real API client over a
// fake fetch (so tests see exactly the requests the app would send).
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import type { InitialEntry } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '../app/providers';
import { routes } from '../app/routes';
import { createApiClient } from '../lib/api-client';
import { TEST_API_URL, createFakeApi } from './fake-api';
import type { FakeApi } from './fake-api';
import type { FakeAuth } from './fake-auth';

export function renderApp(entry: InitialEntry, auth: FakeAuth, fakeApi: FakeApi = createFakeApi()) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  const api = createApiClient({ baseUrl: TEST_API_URL, auth: auth.client, fetch: fakeApi.fetch });
  render(
    <AppProviders auth={auth.client} api={api}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
