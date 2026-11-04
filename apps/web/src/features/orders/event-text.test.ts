import type { OrderEventView } from '@ssom/shared';
import { describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { describeEvent } from './event-text';

const t = strings.orders.timeline;

const event = (overrides: Partial<OrderEventView>): OrderEventView => ({
  id: 'e1',
  type: 'ORDER_CREATED',
  actor: null,
  oldValue: null,
  newValue: null,
  reason: null,
  createdAt: '2026-11-01T06:00:00.000Z',
  ...overrides,
});

describe('describeEvent', () => {
  it('says what happened in plain words, with money formatted', () => {
    expect(describeEvent(event({ newValue: { totalAmount: '3450.00' } }), 'LKR')).toBe(
      t.createdWithTotal('LKR 3,450.00'),
    );
    expect(
      describeEvent(
        event({
          type: 'ORDER_STATUS_CHANGED',
          oldValue: { orderStatus: 'NEW' },
          newValue: { orderStatus: 'CANCELLED' },
        }),
        'LKR',
      ),
    ).toBe(t.status('New', 'Cancelled'));
    expect(
      describeEvent(event({ type: 'PAYMENT_RECORDED', newValue: { amount: '1000.00' } }), 'LKR'),
    ).toBe(t.payment('LKR 1,000.00'));
    expect(
      describeEvent(
        event({ type: 'COD_STATUS_CHANGED', newValue: { codStatus: 'NOT_APPLICABLE' } }),
        'LKR',
      ),
    ).toBe(t.cod(strings.codStatus.NOT_APPLICABLE));
    expect(
      describeEvent(event({ type: 'ORDER_UPDATED', newValue: { totalAmount: '2050.00' } }), 'LKR'),
    ).toBe(t.updatedWithTotal('LKR 2,050.00'));
  });

  it('never shows raw codes or crashes on an unexpected shape', () => {
    expect(describeEvent(event({ newValue: 'odd' }), 'LKR')).toBe(t.created);
    expect(
      describeEvent(
        event({ type: 'ORDER_STATUS_CHANGED', newValue: { orderStatus: 'SHIPPED' } }),
        'LKR',
      ),
    ).toBe(t.updated);
    expect(describeEvent(event({ type: 'DELIVERY_STATUS_CHANGED', newValue: [] }), 'LKR')).toBe(
      t.deliveryChanged,
    );
    expect(describeEvent(event({ type: 'REFUND_RECORDED', newValue: { amount: 5 } }), 'LKR')).toBe(
      t.refundRecorded,
    );
  });
});
