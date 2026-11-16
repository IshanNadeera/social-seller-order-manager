// Data for the dashboard (docs/DEVELOPMENT.md §6.2), through TanStack Query.
import type { DashboardSummary, OrderSummary, Page } from '@ssom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { useBusinessId } from '../account/use-business';
import type { DateRange } from './dashboard-range';

export const dashboardKeys = {
  all: (businessId: string) => ['dashboard', businessId] as const,
  summary: (businessId: string, range: DateRange) =>
    ['dashboard', businessId, 'summary', range] as const,
};

/** How many of the newest orders the dashboard lists. */
export const RECENT_ORDERS = 5;

/** GET /dashboard/summary for `range` (local dates, both included); nothing while `enabled` is false. */
export function useDashboardSummary(range: DateRange, enabled = true) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: dashboardKeys.summary(businessId, range),
    queryFn: ({ signal }) =>
      api.get<DashboardSummary>(`/dashboard/summary?from=${range.from}&to=${range.to}`, { signal }),
    enabled,
    // Keep the figures on screen while another period loads.
    placeholderData: keepPreviousData,
  });
}

/** The newest orders, from the orders list (§6.3 sorting: newest first). */
export function useRecentOrders() {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: [...dashboardKeys.all(businessId), 'recent'],
    queryFn: ({ signal }) =>
      api.get<Page<OrderSummary>>(`/orders?page=1&pageSize=${RECENT_ORDERS}`, { signal }),
  });
}
