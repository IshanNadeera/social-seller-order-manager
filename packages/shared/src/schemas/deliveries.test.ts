import { describe, expect, it } from 'vitest';
import { deliveryUpdateSchema } from '../index.js';

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
