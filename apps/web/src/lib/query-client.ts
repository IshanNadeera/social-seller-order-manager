import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-client';

/** How many times a failed query is tried again (network trouble or a server error only). */
export const QUERY_RETRIES = 1;

/**
 * Retry a query only when trying again could help: no response (offline, timeout) or a 5xx.
 * A 4xx (not signed in, not found, validation) will fail the same way again.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= QUERY_RETRIES) return false;
  if (!isApiError(error)) return true;
  return error.status === 0 || error.status >= 500;
}

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
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
