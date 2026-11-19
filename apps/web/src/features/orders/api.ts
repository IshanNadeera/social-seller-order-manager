// Data the order form needs (docs/DEVELOPMENT.md §6.4, §9.2–§9.4), through TanStack Query.
import type {
  CodAwaitingItem,
  CustomerSummary,
  OrderDetail,
  OrderEventView,
  OrderSummary,
  Page,
  PaymentView,
  PossibleDuplicate,
  ProductView,
} from '@ssom/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { listApiPath } from '../../lib/use-list-params';
import { useBusinessId } from '../account/use-business';
import { customerKeys } from '../customers/api';
import { dashboardKeys } from '../dashboard/api';
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
  payments: (businessId: string, id: string) => ['orders', businessId, 'payments', id] as const,
  /** One customer's order history (§6.6). */
  customer: (businessId: string, customerId: string) =>
    ['orders', businessId, 'customer', customerId] as const,
};

/** COD the couriers still hold (§2.2). Settling or delivering anything changes it. */
export const codKeys = {
  all: (businessId: string) => ['cod', businessId] as const,
};

/** Orders shown at once on "COD to settle": the most one remittance can settle. */
export const COD_AWAITING_PAGE_SIZE = 50;

/** GET /cod/awaiting: by courier, oldest delivery first. */
export function useCodAwaiting() {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: [...codKeys.all(businessId), 'awaiting'],
    queryFn: ({ signal }) =>
      api.get<Page<CodAwaitingItem>>(`/cod/awaiting?page=1&pageSize=${COD_AWAITING_PAGE_SIZE}`, {
        signal,
      }),
  });
}

/** Orders per page in a customer's order history. */
export const CUSTOMER_ORDERS_PAGE_SIZE = 10;

/** GET /customers/:id/orders, newest first (§9.2). */
export function useCustomerOrders(customerId: string, page: number) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: [...orderKeys.customer(businessId, customerId), page],
    queryFn: ({ signal }) =>
      api.get<Page<OrderSummary>>(
        `/customers/${encodeURIComponent(customerId)}/orders?page=${page}&pageSize=${CUSTOMER_ORDERS_PAGE_SIZE}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

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

/** Payment records per page on the order page. */
export const PAYMENTS_PAGE_SIZE = 25;

/** GET /orders/:id/payments: payments and refunds, oldest first (§6.5). */
export function useOrderPayments(id: string, page: number) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: [...orderKeys.payments(businessId, id), page],
    queryFn: ({ signal }) =>
      api.get<Page<PaymentView>>(
        `/orders/${encodeURIComponent(id)}/payments?page=${page}&pageSize=${PAYMENTS_PAGE_SIZE}`,
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
    void queryClient.invalidateQueries({ queryKey: orderKeys.payments(businessId, order.id) });
    void queryClient.invalidateQueries({ queryKey: [...orderKeys.all(businessId), 'list'] });
    void queryClient.invalidateQueries({ queryKey: [...orderKeys.all(businessId), 'customer'] });
    void queryClient.invalidateQueries({ queryKey: codKeys.all(businessId) });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(businessId) });
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

/** How long the total must stay the same before the duplicate check runs. */
export const DUPLICATE_CHECK_DELAY_MS = 500;

/**
 * GET /orders/possible-duplicates (§2.2) for the order being entered: nothing is asked until a
 * customer is chosen and the total has settled. Only ever a warning.
 */
export function usePossibleDuplicates(customerId: string, total: string | null) {
  const api = useApi();
  const businessId = useBusinessId();
  const settledTotal = useDebouncedValue(total, DUPLICATE_CHECK_DELAY_MS);
  return useQuery({
    queryKey: [...orderKeys.all(businessId), 'duplicates', customerId, settledTotal],
    queryFn: ({ signal }) =>
      api.get<PossibleDuplicate[]>(
        `/orders/possible-duplicates?customerId=${encodeURIComponent(customerId)}&total=${settledTotal ?? ''}`,
        { signal },
      ),
    enabled: customerId !== '' && settledTotal !== null,
  });
}

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
