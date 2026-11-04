import { describe, expect, it } from 'vitest';
import {
  hasOrderFilters,
  orderListApiPath,
  orderListQuery,
  readOrderListParams,
} from './order-list-params';

const read = (query: string) => readOrderListParams(new URLSearchParams(query));

describe('order list params (§6.3, §9.5)', () => {
  it('reads the §9.5 example and turns it back into the same request', () => {
    const params = read(
      'page=2&orderStatus=READY&deliveryStatus=DISPATCHED&sourceChannel=WHATSAPP&from=2026-10-01&to=2026-10-31',
    );
    expect(params).toEqual({
      q: '',
      page: 2,
      orderStatus: 'READY',
      paymentStatus: null,
      deliveryStatus: 'DISPATCHED',
      sourceChannel: 'WHATSAPP',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(orderListApiPath(params)).toBe(
      '/orders?page=2&orderStatus=READY&deliveryStatus=DISPATCHED&sourceChannel=WHATSAPP&from=2026-10-01&to=2026-10-31',
    );
    expect(hasOrderFilters(params)).toBe(true);
  });

  it('defaults to page 1 with nothing set', () => {
    const params = read('');
    expect(orderListApiPath(params)).toBe('/orders');
    expect(hasOrderFilters(params)).toBe(false);
    expect(orderListQuery({ ...params, q: 'nim' })).toBe('q=nim');
  });

  it('ignores values the API would refuse (old or edited links)', () => {
    expect(
      read('orderStatus=SHIPPED&paymentStatus=paid&from=2026-13-01&to=yesterday&page=-3'),
    ).toEqual(read(''));
  });
});
