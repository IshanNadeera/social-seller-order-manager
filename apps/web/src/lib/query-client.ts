import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query defaults for the app.
 * Mutations never retry automatically: a create-order or record-payment request is retried only
 * on purpose, with the same Idempotency-Key (docs/DEVELOPMENT.md §9.8), never silently.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
