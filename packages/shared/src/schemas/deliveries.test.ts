import { describe, expect, it } from 'vitest';
import {
  deliveryDeliveredSchema,
  deliveryDispatchSchema,
  deliveryFailedSchema,
  deliveryReturnedSchema,
  deliveryUpdateSchema,
} from '../index.js';

const errors = (body: object) =>
  Object.fromEntries(
    (deliveryUpdateSchema.safeParse(body).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('deliveryUpdateSchema (§9.4)', () => {
  it('takes only what changes; blanks clear optional fields; money is normalised', () => {
    expect(deliveryUpdateSchema.parse({ courierName: ' Domex ', codAmount: '1500' })).toMatchObject(
      {
        courierName: 'Domex',
        codAmount: '1500.00',
      },
    );
    expect(deliveryUpdateSchema.parse({ trackingNumber: '' })).toMatchObject({
      trackingNumber: null,
    });
  });

  it('refuses an empty edit, blank required address fields, statuses and client extras', () => {
    expect(errors({})).toEqual({ '': 'Change at least one field.' });
    expect(Object.keys(errors({ recipientName: ' ', addressLine1: '' }))).toEqual([
      'recipientName',
      'addressLine1',
    ]);
    for (const field of ['status', 'codStatus', 'label', 'businessId', 'sourceAddressId']) {
      const result = deliveryUpdateSchema.safeParse({ notes: 'x', [field]: 'y' });
      expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('checks the COD amount and district like everywhere else', () => {
    expect(Object.keys(errors({ codAmount: '-1' }))).toEqual(['codAmount']);
    expect(errors({ district: 'kandy' })).toEqual({});
    expect(Object.keys(errors({ district: 'Atlantis' }))).toEqual(['district']);
  });
});

describe('delivery action bodies (§7.2)', () => {
  it('dispatch takes optional courier details; delivered takes nothing', () => {
    expect(deliveryDispatchSchema.parse({})).toEqual({});
    expect(deliveryDispatchSchema.parse({ courierName: 'Domex', trackingNumber: ' DX1 ' })).toEqual(
      {
        courierName: 'Domex',
        trackingNumber: 'DX1',
      },
    );
    expect(deliveryDeliveredSchema.safeParse({}).success).toBe(true);
    expect(deliveryDeliveredSchema.safeParse({ status: 'DELIVERED' }).success).toBe(false);
  });

  it('failed needs a reason; returned may have one', () => {
    expect(deliveryFailedSchema.safeParse({ reason: '  ' }).error?.issues[0]?.message).toBe(
      'Say why the delivery failed.',
    );
    expect(deliveryFailedSchema.parse({ reason: ' Nobody home ' })).toEqual({
      reason: 'Nobody home',
    });
    expect(deliveryReturnedSchema.parse({})).toEqual({});
    expect(deliveryReturnedSchema.parse({ reason: '' })).toEqual({ reason: null });
  });
});
