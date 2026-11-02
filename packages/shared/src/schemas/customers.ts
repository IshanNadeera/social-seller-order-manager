// Customers API requests (docs/DEVELOPMENT.md §6.6, §7.11, §9.2). Used by the API to validate and by
// the web forms (B6), so both apply the same rules and messages. Strict: unknown fields are refused.
import { z } from 'zod';
import { PHONE_MAX_LENGTH } from '../phone.js';

export const CUSTOMER_NAME_MAX_LENGTH = 100;
export const CUSTOMER_NOTES_MAX_LENGTH = 1000;
export const ADDRESS_FIELD_MAX_LENGTH = 200;
export const ADDRESS_SHORT_FIELD_MAX_LENGTH = 50;
export const CUSTOMER_SEARCH_MAX_LENGTH = 100;
/** §6.3 / §9.5: default 25 per page, never more than 100. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** "" or only spaces → null, so a cleared form field clears the value. */
const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const optionalText = (max: number, message: string) =>
  z.preprocess(blankToNull, z.string().trim().max(max, message).nullable().optional());

const name = z
  .string({ error: 'Enter the customer’s name.' })
  .trim()
  .min(1, 'Enter the customer’s name.')
  .max(CUSTOMER_NAME_MAX_LENGTH, `Use at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`);

const phone = optionalText(PHONE_MAX_LENGTH, `Use at most ${PHONE_MAX_LENGTH} characters.`);

const email = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(254, 'Use at most 254 characters.')
    .pipe(z.email('Enter a valid email address, like name@example.com.'))
    .transform((value) => value.toLowerCase())
    .nullable()
    .optional(),
);

const notes = optionalText(
  CUSTOMER_NOTES_MAX_LENGTH,
  `Use at most ${CUSTOMER_NOTES_MAX_LENGTH} characters.`,
);

/** A delivery address (§7.11): only the first line is required besides recipient and phone. */
export const addressInputSchema = z.strictObject({
  label: optionalText(
    ADDRESS_SHORT_FIELD_MAX_LENGTH,
    `Use at most ${ADDRESS_SHORT_FIELD_MAX_LENGTH} characters.`,
  ),
  recipientName: z
    .string({ error: 'Enter who receives the parcel.' })
    .trim()
    .min(1, 'Enter who receives the parcel.')
    .max(CUSTOMER_NAME_MAX_LENGTH, `Use at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`),
  phone: z
    .string({ error: 'Enter a phone number for the delivery.' })
    .trim()
    .min(1, 'Enter a phone number for the delivery.')
    .max(PHONE_MAX_LENGTH, `Use at most ${PHONE_MAX_LENGTH} characters.`),
  addressLine1: z
    .string({ error: 'Enter the address.' })
    .trim()
    .min(1, 'Enter the address.')
    .max(ADDRESS_FIELD_MAX_LENGTH, `Use at most ${ADDRESS_FIELD_MAX_LENGTH} characters.`),
  addressLine2: optionalText(
    ADDRESS_FIELD_MAX_LENGTH,
    `Use at most ${ADDRESS_FIELD_MAX_LENGTH} characters.`,
  ),
  city: optionalText(
    ADDRESS_SHORT_FIELD_MAX_LENGTH,
    `Use at most ${ADDRESS_SHORT_FIELD_MAX_LENGTH} characters.`,
  ),
  district: optionalText(
    ADDRESS_SHORT_FIELD_MAX_LENGTH,
    `Use at most ${ADDRESS_SHORT_FIELD_MAX_LENGTH} characters.`,
  ),
  postalCode: optionalText(20, 'Use at most 20 characters.'),
});

/** POST /customers. The optional address becomes the customer's default address. */
export const customerCreateSchema = z.strictObject({
  name,
  phone,
  email,
  notes,
  address: addressInputSchema.optional(),
});

/** PATCH /customers/:id. Send only what changes; null (or "") clears phone, email or notes. */
export const customerUpdateSchema = z
  .strictObject({ name: name.optional(), phone, email, notes })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one field.',
  });

const pageNumber = z.coerce
  .number({ error: 'Must be a whole number.' })
  .int('Must be a whole number.')
  .min(1, 'Must be 1 or more.');

/** GET /customers query string. Values arrive as strings. */
export const customerListQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(CUSTOMER_SEARCH_MAX_LENGTH, `Use at most ${CUSTOMER_SEARCH_MAX_LENGTH} characters.`)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  page: pageNumber.default(1),
  pageSize: pageNumber
    .max(MAX_PAGE_SIZE, `Use at most ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE),
  includeArchived: z
    .enum(['true', 'false'], { error: 'Use true or false.' })
    .default('false')
    .transform((value) => value === 'true'),
});

export type AddressInput = z.output<typeof addressInputSchema>;
export type CustomerCreateRequest = z.input<typeof customerCreateSchema>;
export type CustomerCreateInput = z.output<typeof customerCreateSchema>;
export type CustomerUpdateRequest = z.input<typeof customerUpdateSchema>;
export type CustomerUpdateInput = z.output<typeof customerUpdateSchema>;
export type CustomerListQuery = z.output<typeof customerListQuerySchema>;
