import { describe, expect, it } from 'vitest';
import { DELIVERY_STATUSES, ORDER_STAGES, ORDER_STAGE_LABELS, ORDER_STATUSES, orderStage } from './index.js';
import type { DeliveryStatus, OrderStage, OrderStatus } from './index.js';

const ANY: (DeliveryStatus | null)[] = [null, ...DELIVERY_STATUSES];

describe('orderStage: every row of the §7.3 table', () => {
  it.each([
    ['NEW', ANY, 'NEW'],
    ['PENDING_CONFIRMATION', ANY, 'AWAITING_CONFIRMATION'],
    ['CONFIRMED', ANY, 'CONFIRMED'],
    ['PREPARING', ANY, 'PREPARING'],
    ['READY', ['PENDING'], 'READY_TO_SEND'],
    ['READY', [null], 'READY_FOR_PICKUP'],
    ['READY', ['DISPATCHED'], 'OUT_FOR_DELIVERY'],
    ['READY', ['FAILED'], 'DELIVERY_FAILED'],
    ['COMPLETED', ['DELIVERED', null], 'COMPLETED'],
    ['CANCELLED', ANY, 'CANCELLED'],
    ['RETURNED', ANY, 'RETURNED'],
  ] as [OrderStatus, (DeliveryStatus | null)[], OrderStage][])(
    '%s with delivery %j → %s',
    (orderStatus, deliveryStatuses, stage) => {
      for (const deliveryStatus of deliveryStatuses) {
        expect(orderStage(orderStatus, deliveryStatus)).toBe(stage);
      }
    },
  );

  it('falls back to the order status for pairs the workflow cannot produce', () => {
    expect(orderStage('READY', 'DELIVERED')).toBe('READY_TO_SEND');
    expect(orderStage('READY', 'RETURNED')).toBe('READY_TO_SEND');
    expect(orderStage('COMPLETED', 'RETURNED')).toBe('COMPLETED');
  });

  it('gives a stage with a label for every possible pair', () => {
    for (const orderStatus of ORDER_STATUSES) {
      for (const deliveryStatus of ANY) {
        const stage = orderStage(orderStatus, deliveryStatus);
        expect(ORDER_STAGES).toContain(stage);
        expect(ORDER_STAGE_LABELS[stage]).toMatch(/\S/);
      }
    }
  });
});

describe('ORDER_STAGE_LABELS', () => {
  it('uses the §7.3 wording, one label per stage', () => {
    expect(ORDER_STAGE_LABELS.OUT_FOR_DELIVERY).toBe('Out for delivery');
    expect(ORDER_STAGE_LABELS.AWAITING_CONFIRMATION).toBe('Awaiting confirmation');
    expect(new Set(Object.values(ORDER_STAGE_LABELS)).size).toBe(ORDER_STAGES.length);
  });
});
