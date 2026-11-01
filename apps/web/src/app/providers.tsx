import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { createQueryClient } from '../lib/query-client';

/** App-wide providers. Auth (A19) joins here later. */
export function AppProviders({ children }: { children: ReactNode }) {
  // One client per mounted app (and per test), created once.
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
