// PATCH /orders/:id/delivery (docs/DEVELOPMENT.md §9.4, §7.4, §7.8). Send only what changes. The
// server decides what may still change: the address before dispatch, courier details until the
// order is returned, the COD amount before dispatch and within the balance due.
import { z } from 'zod';
import { changeAtLeastOneField, changesSomething, optionalText } from './common.js';
import { addressInputSchema } from './customers.js';
import { moneySchema } from './money.js';

export const COURIER_FIELD_MAX_LENGTH = 100;
export const DELIVERY_NOTES_MAX_LENGTH = 500;

/** The address fields of a delivery (its own copy, §7.11); all optional here. */
export const DELIVERY_ADDRESS_FIELDS = [
  'recipientName',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'district',
  'postalCode',
] as const;

export const deliveryUpdateSchema = addressInputSchema
  .omit({ label: true })
  .partial()
  .extend({
    courierName: optionalText(COURIER_FIELD_MAX_LENGTH),
    trackingNumber: optionalText(COURIER_FIELD_MAX_LENGTH),
    /** What the courier collects; 0 up to the balance due (§7.8). */
    codAmount: moneySchema('Enter the COD amount.').optional(),
    /** Notes for this delivery, e.g. "Call before arriving". */
    notes: optionalText(DELIVERY_NOTES_MAX_LENGTH),
  })
  .refine(changesSomething, changeAtLeastOneField);

export type DeliveryUpdateRequest = z.input<typeof deliveryUpdateSchema>;
export type DeliveryUpdateInput = z.output<typeof deliveryUpdateSchema>;
