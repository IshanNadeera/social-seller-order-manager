import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthClient } from '../features/auth/auth-client';
import { createQueryClient } from '../lib/query-client';

/** App-wide providers. `auth` is supabase-js's auth client in the app and a fake in tests. */
export function AppProviders({ auth, children }: { auth: AuthClient; children: ReactNode }) {
  // One client per mounted app (and per test), created once.
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={auth}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
