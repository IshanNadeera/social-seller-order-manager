// A searchable, paged list's state in the URL (?q=&page=&archived=1), so Back and refresh keep it
// (docs/DEVELOPMENT.md §6.3). Used by the customer and product lists.
import { useSearchParams } from 'react-router';

export interface ListParams {
  q: string;
  page: number;
  includeArchived: boolean;
}

export function readListParams(searchParams: URLSearchParams): ListParams {
  const page = Number(searchParams.get('page'));
  return {
    q: searchParams.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    includeArchived: searchParams.get('archived') === '1',
  };
}

/**
 * The current list params, and a function to change some of them. A change that doesn't set `page`
 * (a new search or filter) starts again at page 1. `replace` keeps typing out of the Back history.
 */
export function useListParams(): [
  ListParams,
  (changes: Partial<ListParams>, options: { replace: boolean }) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();
  const update = (changes: Partial<ListParams>, options: { replace: boolean }) => {
    setSearchParams((current) => {
      const next = { ...readListParams(current), page: 1, ...changes };
      const query = new URLSearchParams();
      if (next.q !== '') query.set('q', next.q);
      if (next.page > 1) query.set('page', String(next.page));
      if (next.includeArchived) query.set('archived', '1');
      return query;
    }, options);
  };
  return [readListParams(searchParams), update];
}

/** The API path for a list request, e.g. /customers?q=nim&page=2; defaults are left out. */
export function listApiPath(base: string, { q, page, includeArchived }: ListParams): string {
  const query = new URLSearchParams();
  if (q !== '') query.set('q', q);
  if (page > 1) query.set('page', String(page));
  if (includeArchived) query.set('includeArchived', 'true');
  const search = query.toString();
  return search === '' ? base : `${base}?${search}`;
}
