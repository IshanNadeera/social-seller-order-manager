import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthClient } from '../features/auth/auth-client';
import type { ApiClient } from '../lib/api-client';
import { ApiProvider } from '../lib/api-context';
import { createQueryClient } from '../lib/query-client';

/**
 * App-wide providers. In the app, `auth` is supabase-js's auth client and `api` the real API client;
 * tests pass a fake auth client and an API client over a fake fetch.
 */
export function AppProviders({
  auth,
  api,
  children,
}: {
  auth: AuthClient;
  api: ApiClient;
  children: ReactNode;
}) {
  // One client per mounted app (and per test), created once.
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={auth}>
        <ApiProvider client={api}>{children}</ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
