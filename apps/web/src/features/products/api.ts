// Product data from the API (docs/DEVELOPMENT.md §9.3), through TanStack Query.
import type { Page, ProductView } from '@ssom/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api-context';
import { listApiPath } from '../../lib/use-list-params';
import type { ListParams } from '../../lib/use-list-params';
import { useBusinessId } from '../account/use-business';

/** Cache keys, scoped by business like the customers' (features/customers/api.ts). */
export const productKeys = {
  all: (businessId: string) => ['products', businessId] as const,
  list: (businessId: string, params: ListParams) =>
    ['products', businessId, 'list', params] as const,
  detail: (businessId: string, id: string) => ['products', businessId, 'detail', id] as const,
};

export function useProductList(params: ListParams) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: productKeys.list(businessId, params),
    queryFn: ({ signal }) =>
      api.get<Page<ProductView>>(listApiPath('/products', params), { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  const api = useApi();
  const businessId = useBusinessId();
  return useQuery({
    queryKey: productKeys.detail(businessId, id),
    queryFn: ({ signal }) =>
      api.get<ProductView>(`/products/${encodeURIComponent(id)}`, { signal }),
  });
}

/** After a change: cache the product the API returned, and refetch the lists. */
export function useProductSaved() {
  const queryClient = useQueryClient();
  const businessId = useBusinessId();
  return (product: ProductView) => {
    queryClient.setQueryData(productKeys.detail(businessId, product.id), product);
    void queryClient.invalidateQueries({ queryKey: [...productKeys.all(businessId), 'list'] });
  };
}
