// PATCH /orders/:id/delivery (docs/DEVELOPMENT.md §9.4, §7.4, §7.8). Send only what changes. The
// server decides what may still change: the address before dispatch, courier details until the
// order is returned, the COD amount before dispatch and within the balance due.
import { z } from 'zod';
import { STATUS_REASON_MAX_LENGTH } from '../constants.js';
import { changeAtLeastOneField, changesSomething, optionalText, requiredText } from './common.js';
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

// ---------- Delivery actions (§7.2, ADR-012): one endpoint each, so each checks its own rules ----------

/** POST /orders/:id/delivery/dispatch: the courier details can be given at the same time. */
export const deliveryDispatchSchema = z.strictObject({
  courierName: optionalText(COURIER_FIELD_MAX_LENGTH),
  trackingNumber: optionalText(COURIER_FIELD_MAX_LENGTH),
});

/** POST /orders/:id/delivery/delivered: nothing to send. */
export const deliveryDeliveredSchema = z.strictObject({});

/** POST /orders/:id/delivery/failed: why it failed is required (§7.2). */
export const deliveryFailedSchema = z.strictObject({
  reason: requiredText(STATUS_REASON_MAX_LENGTH, 'Say why the delivery failed.'),
});

/** POST /orders/:id/delivery/returned: a reason; required when a delivered parcel comes back. */
export const deliveryReturnedSchema = z.strictObject({
  reason: optionalText(STATUS_REASON_MAX_LENGTH),
});

export type DeliveryDispatchInput = z.output<typeof deliveryDispatchSchema>;
export type DeliveryFailedInput = z.output<typeof deliveryFailedSchema>;
export type DeliveryReturnedInput = z.output<typeof deliveryReturnedSchema>;
