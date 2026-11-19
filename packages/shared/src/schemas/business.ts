// PATCH /api/v1/business (docs/DEVELOPMENT.md §6.8, §9.1): the business profile. The same rules and
// messages as onboarding; currency stays LKR (read-only in the MVP). Used by the API to validate the
// body and by the web settings form.
import { z } from 'zod';
import { ORDER_PREFIX_PATTERN } from '../order-prefix.js';
import { moneySchema } from './money.js';
import { BUSINESS_NAME_MAX_LENGTH, CONTACT_PHONE_MAX_LENGTH } from './onboarding.js';

/** A time zone the platform knows by its IANA name, such as "Asia/Colombo". */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const businessUpdateSchema = z
  .strictObject({
    name: z
      .string({ error: 'Enter your business name.' })
      .trim()
      .min(1, 'Enter your business name.')
      .max(BUSINESS_NAME_MAX_LENGTH, `Use at most ${BUSINESS_NAME_MAX_LENGTH} characters.`)
      .optional(),
    /** An empty value removes the phone. */
    contactPhone: z
      .string({ error: 'Enter the phone number as text, like 077 123 4567.' })
      .trim()
      .max(CONTACT_PHONE_MAX_LENGTH, `Use at most ${CONTACT_PHONE_MAX_LENGTH} characters.`)
      .transform((phone) => (phone === '' ? null : phone))
      .optional(),
    orderPrefix: z
      .string({ error: 'Use 2 to 6 letters or numbers, for example NIM.' })
      .trim()
      .toUpperCase()
      .regex(ORDER_PREFIX_PATTERN, 'Use 2 to 6 letters or numbers, for example NIM.')
      .optional(),
    defaultDeliveryFee: moneySchema('Enter the delivery fee, or 0.').optional(),
    timezone: z
      .string({ error: 'Choose a time zone from the list.' })
      .trim()
      .refine(isTimeZone, 'Choose a time zone from the list.')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one setting.',
    when: (payload) => payload.issues.length === 0,
  });

/** What the client sends. */
export type BusinessUpdateRequest = z.input<typeof businessUpdateSchema>;
/** What the API works with (trimmed, prefix uppercased, empty phone → null, money normalised). */
export type BusinessUpdateInput = z.output<typeof businessUpdateSchema>;
