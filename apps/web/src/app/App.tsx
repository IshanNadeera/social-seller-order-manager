import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createApiClient } from '../lib/api-client';
import { supabaseAuth, webEnv } from '../lib/supabase';
import { AppProviders } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);
const api = createApiClient({ baseUrl: webEnv.apiUrl, auth: supabaseAuth });

export function App() {
  return (
    <AppProviders auth={supabaseAuth} api={api}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
