import { describe, expect, it } from 'vitest';
import {
  COD_STATUSES,
  DELIVERY_STATUSES,
  FULFILMENT_TYPES,
  MEMBER_ROLES,
  ORDER_EVENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  SOURCE_CHANNELS,
  isCodStatus,
  isDeliveryStatus,
  isFulfilmentType,
  isMemberRole,
  isOrderEventType,
  isOrderStatus,
  isPaymentMethod,
  isPaymentStatus,
  isPaymentType,
  isSourceChannel,
} from './index.js';

// The exact codes from docs/DEVELOPMENT.md §7 and §8.4. Changing a code is a data migration,
// so these lists are spelled out here on purpose rather than derived from the source.
const expected = {
  ORDER_STATUSES: [
    'NEW',
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'COMPLETED',
    'CANCELLED',
    'RETURNED',
  ],
  PAYMENT_STATUSES: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  DELIVERY_STATUSES: ['PENDING', 'DISPATCHED', 'DELIVERED', 'FAILED', 'RETURNED'],
  COD_STATUSES: ['NOT_APPLICABLE', 'PENDING', 'COLLECTED', 'SETTLED'],
  SOURCE_CHANNELS: [
    'FACEBOOK',
    'INSTAGRAM',
    'TIKTOK',
    'WHATSAPP',
    'PHONE',
    'WALK_IN',
    'WEBSITE',
    'OTHER',
  ],
  FULFILMENT_TYPES: ['DELIVERY', 'PICKUP'],
  PAYMENT_METHODS: ['CASH', 'BANK_TRANSFER', 'COD', 'OTHER'],
  PAYMENT_TYPES: ['PAYMENT', 'REFUND'],
  MEMBER_ROLES: ['OWNER', 'STAFF'],
  ORDER_EVENT_TYPES: [
    'ORDER_CREATED',
    'ORDER_UPDATED',
    'ORDER_STATUS_CHANGED',
    'DELIVERY_STATUS_CHANGED',
    'PAYMENT_RECORDED',
    'REFUND_RECORDED',
    'COD_STATUS_CHANGED',
    'NOTE_ADDED',
  ],
};

const enums = [
  { name: 'ORDER_STATUSES', values: ORDER_STATUSES, guard: isOrderStatus },
  { name: 'PAYMENT_STATUSES', values: PAYMENT_STATUSES, guard: isPaymentStatus },
  { name: 'DELIVERY_STATUSES', values: DELIVERY_STATUSES, guard: isDeliveryStatus },
  { name: 'COD_STATUSES', values: COD_STATUSES, guard: isCodStatus },
  { name: 'SOURCE_CHANNELS', values: SOURCE_CHANNELS, guard: isSourceChannel },
  { name: 'FULFILMENT_TYPES', values: FULFILMENT_TYPES, guard: isFulfilmentType },
  { name: 'PAYMENT_METHODS', values: PAYMENT_METHODS, guard: isPaymentMethod },
  { name: 'PAYMENT_TYPES', values: PAYMENT_TYPES, guard: isPaymentType },
  { name: 'MEMBER_ROLES', values: MEMBER_ROLES, guard: isMemberRole },
  { name: 'ORDER_EVENT_TYPES', values: ORDER_EVENT_TYPES, guard: isOrderEventType },
] as const;

describe.each(enums)('$name', ({ name, values, guard }) => {
  it('matches the blueprint exactly, in order', () => {
    expect(values).toEqual(expected[name]);
  });

  it('has no duplicate codes', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('accepts every code', () => {
    for (const value of values) expect(guard(value)).toBe(true);
  });

  it.each([values[0].toLowerCase(), ` ${values[0]}`, '', 'UNKNOWN', 1, null, undefined, {}])(
    'rejects %j',
    (value) => {
      expect(guard(value)).toBe(false);
    },
  );
});

describe('statuses that must not be mixed up', () => {
  it('keeps delivery-only states out of the order status list', () => {
    for (const deliveryOnly of ['DISPATCHED', 'DELIVERED', 'FAILED']) {
      expect(isOrderStatus(deliveryOnly)).toBe(false);
    }
  });
});
