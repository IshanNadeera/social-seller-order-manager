// Data the order form needs (docs/DEVELOPMENT.md §6.4, §9.2–§9.4), through TanStack Query.
import type { CustomerSummary, OrderSummary, Page, ProductView } from '@ssom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { listApiPath } from '../../lib/use-list-params';
import { useBusinessId } from '../account/use-business';
import { customerKeys } from '../customers/api';
import { productKeys } from '../products/api';
import { orderListApiPath } from './order-list-params';
import type { OrderListParams } from './order-list-params';

/** Cache keys, scoped by business like the customers' (features/customers/api.ts). */
export const orderKeys = {
  all: (businessId: string) => ['orders', businessId] as const,
  list: (businessId: string, params: OrderListParams) =>
    ['orders', businessId, 'list', params] as const,
};

/** GET /orders with the list's search, filters and page (§6.3, §9.5). */
export function useOrderList(params: OrderListParams) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: orderKeys.list(businessId, params),
    queryFn: ({ signal }) => api.get<Page<OrderSummary>>(orderListApiPath(params), { signal }),
    // Keep showing the current page while the next search, filter or page loads.
    placeholderData: keepPreviousData,
  });
}

/** How long typing pauses before a search is sent. */
export const SEARCH_DELAY_MS = 250;

/** Active customers matching `text` (name or phone); nothing is fetched for blank text. */
export function useCustomerSearch(text: string) {
  const api = useApi();
  const businessId = useBusinessId();
  const q = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const params = { q, page: 1, includeArchived: false };
  return useQuery({
    queryKey: customerKeys.list(businessId, params),
    queryFn: ({ signal }) =>
      api.get<Page<CustomerSummary>>(listApiPath('/customers', params), { signal }),
    enabled: q !== '',
  });
}

/** Active products matching `text` (name or SKU); nothing is fetched for blank text. */
export function useProductSearch(text: string) {
  const api = useApi();
  const businessId = useBusinessId();
  const q = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const params = { q, page: 1, includeArchived: false };
  return useQuery({
    queryKey: productKeys.list(businessId, params),
    queryFn: ({ signal }) =>
      api.get<Page<ProductView>>(listApiPath('/products', params), { signal }),
    enabled: q !== '',
  });
}
