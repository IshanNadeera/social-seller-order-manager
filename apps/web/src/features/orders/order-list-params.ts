// The orders list's search, filters and page, kept in the URL so Back and refresh keep them
// (docs/DEVELOPMENT.md §6.3, §9.5). The names match GET /orders, so the URL reads like the request.
import {
  isDeliveryStatus,
  isIsoDate,
  isOrderStatus,
  isPaymentStatus,
  isSourceChannel,
} from '@ssom/shared';
import type { DeliveryStatus, OrderStatus, PaymentStatus, SourceChannel } from '@ssom/shared';
import { useSearchParams } from 'react-router';

export type OrderListParams = {
  q: string;
  page: number;
  orderStatus: OrderStatus | null;
  paymentStatus: PaymentStatus | null;
  deliveryStatus: DeliveryStatus | null;
  sourceChannel: SourceChannel | null;
  /** YYYY-MM-DD in the business timezone, both included (§9.5). */
  from: string | null;
  to: string | null;
};

/** The filters (everything except the search and the page). */
export const ORDER_FILTERS = [
  'orderStatus',
  'paymentStatus',
  'deliveryStatus',
  'sourceChannel',
  'from',
  'to',
] as const;

export type OrderFilter = (typeof ORDER_FILTERS)[number];

/** A value only if it is one the API accepts; anything else (an old or edited link) is ignored. */
function pick<T extends string>(
  value: string | null,
  isValid: (value: string) => value is T,
): T | null {
  return value !== null && isValid(value) ? value : null;
}

const isDate = (value: string): value is string => isIsoDate(value);

export function readOrderListParams(search: URLSearchParams): OrderListParams {
  const page = Number(search.get('page'));
  return {
    q: search.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    orderStatus: pick(search.get('orderStatus'), isOrderStatus),
    paymentStatus: pick(search.get('paymentStatus'), isPaymentStatus),
    deliveryStatus: pick(search.get('deliveryStatus'), isDeliveryStatus),
    sourceChannel: pick(search.get('sourceChannel'), isSourceChannel),
    from: pick(search.get('from'), isDate),
    to: pick(search.get('to'), isDate),
  };
}

/** The query string for `params`, defaults left out ("" when nothing is set). */
export function orderListQuery(params: OrderListParams): string {
  const query = new URLSearchParams();
  if (params.q !== '') query.set('q', params.q);
  if (params.page > 1) query.set('page', String(params.page));
  for (const filter of ORDER_FILTERS) {
    const value = params[filter];
    if (value !== null) query.set(filter, value);
  }
  return query.toString();
}

/** GET /orders for these params, e.g. /orders?orderStatus=READY&from=2026-10-01. */
export function orderListApiPath(params: OrderListParams): string {
  const query = orderListQuery(params);
  return query === '' ? '/orders' : `/orders?${query}`;
}

export function hasOrderFilters(params: OrderListParams): boolean {
  return ORDER_FILTERS.some((filter) => params[filter] !== null);
}

/**
 * The current params, and a function to change some of them. A change that doesn't set `page` (a new
 * search or filter) starts again at page 1. `replace` keeps typing out of the Back history.
 */
export function useOrderListParams(): [
  OrderListParams,
  (changes: Partial<OrderListParams>, options: { replace: boolean }) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();
  const update = (changes: Partial<OrderListParams>, options: { replace: boolean }) => {
    setSearchParams(
      (current) =>
        new URLSearchParams(
          orderListQuery({ ...readOrderListParams(current), page: 1, ...changes }),
        ),
      options,
    );
  };
  return [readOrderListParams(searchParams), update];
}
