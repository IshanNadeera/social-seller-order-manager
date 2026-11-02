// Customer data from the API (docs/DEVELOPMENT.md §9.2), through TanStack Query.
import type { CustomerDetail, CustomerSummary, Page } from '@ssom/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { listApiPath } from '../../lib/use-list-params';
import type { ListParams } from '../../lib/use-list-params';
import { useBusinessId } from '../account/use-business';

export type CustomerListParams = ListParams;

/**
 * Cache keys. They include the business, so one business's customers can never be shown to another
 * signed in on the same device (the cache is also cleared on sign-out).
 */
export const customerKeys = {
  all: (businessId: string) => ['customers', businessId] as const,
  list: (businessId: string, params: CustomerListParams) =>
    ['customers', businessId, 'list', params] as const,
  detail: (businessId: string, id: string) => ['customers', businessId, 'detail', id] as const,
};

/** GET /customers with the list's search, page and filter. */
export function customerListPath(params: CustomerListParams): string {
  return listApiPath('/customers', params);
}

export function useCustomerList(params: CustomerListParams) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: customerKeys.list(businessId, params),
    queryFn: ({ signal }) => api.get<Page<CustomerSummary>>(customerListPath(params), { signal }),
    // Keep showing the current page while the next search or page loads.
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: customerKeys.detail(businessId, id),
    queryFn: ({ signal }) =>
      api.get<CustomerDetail>(`/customers/${encodeURIComponent(id)}`, { signal }),
  });
}

/**
 * After a change: put the customer the API returned into the cache (every customer and address
 * change answers with the whole customer), and refetch lists, whose names, counts or order may
 * have changed.
 */
export function useCustomerSaved() {
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  return (customer: CustomerDetail) => {
    queryClient.setQueryData(customerKeys.detail(businessId, customer.id), customer);
    void queryClient.invalidateQueries({
      queryKey: [...customerKeys.all(businessId), 'list'],
    });
  };
}
