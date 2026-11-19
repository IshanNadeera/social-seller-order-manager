// The business profile on the settings screen (docs/DEVELOPMENT.md §6.8, §9.1).
import type { BusinessUpdateInput, BusinessView } from '@ssom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { meQueryKey } from '../account/use-me';
import { useBusinessId } from '../account/use-business';
import { useAuth } from '../auth/AuthProvider';

export const businessKeys = {
  profile: (businessId: string) => ['business', businessId] as const,
};

/** GET /business. */
export function useBusinessProfile() {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: businessKeys.profile(businessId),
    queryFn: ({ signal }) => api.get<BusinessView>('/business', { signal }),
  });
}

/**
 * PATCH /business. Afterwards /me is read again, since the whole app uses its business name,
 * timezone and default fee; and everything grouped by date (dashboard, reports) is refetched,
 * since the timezone may have changed.
 */
export function useUpdateBusiness() {
  const api = useApi();
  const businessId = useBusinessId();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: (input: BusinessUpdateInput) => api.patch<BusinessView>('/business', input),
    onSuccess: (business) => {
      queryClient.setQueryData(businessKeys.profile(businessId), business);
      void queryClient.invalidateQueries({ queryKey: meQueryKey(session?.user.id) });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', businessId] });
      void queryClient.invalidateQueries({ queryKey: ['reports', businessId] });
    },
  });
}
