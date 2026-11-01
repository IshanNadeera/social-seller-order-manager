import type { MeResponse } from '@ssom/shared';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { useAuth } from '../auth/AuthProvider';

/**
 * Cache key for GET /me. It includes the user ID, so one person's account data can never be
 * shown to another who signs in on the same device (the cache is also cleared on sign-out).
 */
export function meQueryKey(userId: string | undefined) {
  return ['me', userId ?? 'signed-out'] as const;
}

/** The signed-in user, their business and whether onboarding is still needed (§9.1). */
export function useMe() {
  const { session } = useAuth();
  const api = useApi();
  const userId = session?.user.id;
  return useQuery({
    queryKey: meQueryKey(userId),
    queryFn: ({ signal }) => api.get<MeResponse>('/me', { signal }),
    enabled: userId !== undefined,
  });
}
