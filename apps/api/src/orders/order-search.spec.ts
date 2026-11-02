import { describe, expect, it } from 'vitest';
import { ORDER_LIST_ORDER, orderListWhere } from './order-search';

const scope = { businessId: '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6' };
const base = { page: 1, pageSize: 25 };

describe('orderListWhere', () => {
  it('with no filters: only the business', () => {
    expect(orderListWhere(scope, base, 'Asia/Colombo')).toEqual({
      AND: [],
      businessId: scope.businessId,
    });
  });

  it('turns local dates into exclusive UTC bounds', () => {
    const where = orderListWhere(
      scope,
      { ...base, from: '2026-10-01', to: '2026-10-31' },
      'Asia/Colombo',
    );
    expect(where.AND).toEqual([
      {
        createdAt: {
          gte: new Date('2026-09-30T18:30:00.000Z'),
          lt: new Date('2026-10-31T18:30:00.000Z'),
        },
      },
    ]);
  });

  it('combines status and source filters; delivery status looks at the delivery', () => {
    const where = orderListWhere(
      scope,
      {
        ...base,
        orderStatus: 'READY',
        paymentStatus: 'UNPAID',
        deliveryStatus: 'DISPATCHED',
        sourceChannel: 'WHATSAPP',
      },
      'Asia/Colombo',
    );
    expect(where.AND).toEqual([
      { orderStatus: 'READY' },
      { paymentStatus: 'UNPAID' },
      { sourceChannel: 'WHATSAPP' },
      { delivery: { is: { status: 'DISPATCHED' } } },
    ]);
  });

  it('searches number, name and phone; 9+ digits also match the normalised phone', () => {
    const where = orderListWhere(scope, { ...base, q: '077 123 4567' }, 'UTC');
    expect(JSON.stringify(where)).toContain(
      '{"customer":{"is":{"phoneNormalized":{"endsWith":"771234567"}}}}',
    );
    expect(orderListWhere(scope, { ...base, q: 'NIM_1' }, 'UTC').AND).toEqual([
      {
        OR: [
          { orderNumber: { contains: 'NIM\\_1', mode: 'insensitive' } },
          { customerNameSnapshot: { contains: 'NIM\\_1', mode: 'insensitive' } },
          { customerPhoneSnapshot: { contains: 'NIM\\_1' } },
        ],
      },
    ]);
  });

  it('sorts newest first, then by ID', () => {
    expect(ORDER_LIST_ORDER).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
