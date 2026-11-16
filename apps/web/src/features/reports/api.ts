// Data for the reports (docs/DEVELOPMENT.md §9.4), through TanStack Query.
import type { SalesReport } from '@ssom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { useBusinessId } from '../account/use-business';
import type { DateRange } from '../dashboard/dashboard-range';

export const reportKeys = {
  sales: (businessId: string, range: DateRange) => ['reports', businessId, 'sales', range] as const,
};

/** GET /reports/sales for `range`; nothing while `enabled` is false. */
export function useSalesReport(range: DateRange, enabled = true) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: reportKeys.sales(businessId, range),
    queryFn: ({ signal }) =>
      api.get<SalesReport>(`/reports/sales?from=${range.from}&to=${range.to}`, { signal }),
    enabled,
    // Keep the report on screen while another period loads.
    placeholderData: keepPreviousData,
  });
}
