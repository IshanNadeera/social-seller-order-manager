import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { supabaseAuth } from '../lib/supabase';
import { AppProviders } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <AppProviders auth={supabaseAuth}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
