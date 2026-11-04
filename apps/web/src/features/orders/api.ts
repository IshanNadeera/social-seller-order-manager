// Data the order form needs (docs/DEVELOPMENT.md §6.4, §9.2–§9.4), through TanStack Query.
import type {
  CustomerSummary,
  OrderDetail,
  OrderEventView,
  OrderSummary,
  Page,
  ProductView,
} from '@ssom/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
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
  detail: (businessId: string, id: string) => ['orders', businessId, 'detail', id] as const,
  events: (businessId: string, id: string) => ['orders', businessId, 'events', id] as const,
};

/** Activity entries per page on the order page. */
export const EVENTS_PAGE_SIZE = 25;

/** GET /orders/:id: items, delivery copy and payment summary (§9.4). */
export function useOrder(id: string) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: orderKeys.detail(businessId, id),
    queryFn: ({ signal }) => api.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`, { signal }),
  });
}

/** GET /orders/:id/events, oldest first, one page at a time. */
export function useOrderEvents(id: string, page: number) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: [...orderKeys.events(businessId, id), page],
    queryFn: ({ signal }) =>
      api.get<Page<OrderEventView>>(
        `/orders/${encodeURIComponent(id)}/events?page=${page}&pageSize=${EVENTS_PAGE_SIZE}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * After a change: cache the order the API returned (every order action answers with the whole
 * order), and refetch its activity and the lists, whose stage or totals may have changed.
 */
export function useOrderSaved() {
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  return (order: OrderDetail) => {
    queryClient.setQueryData(orderKeys.detail(businessId, order.id), order);
    void queryClient.invalidateQueries({ queryKey: orderKeys.events(businessId, order.id) });
    void queryClient.invalidateQueries({ queryKey: [...orderKeys.all(businessId), 'list'] });
  };
}

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
