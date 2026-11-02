// POST /api/v1/onboarding request (docs/DEVELOPMENT.md §6.8, §9.1). Used by the API to validate the
// body and by the web onboarding form, so both apply exactly the same rules and messages.
import { z } from 'zod';
import { ORDER_PREFIX_PATTERN } from '../order-prefix.js';

export const BUSINESS_NAME_MAX_LENGTH = 100;
export const CONTACT_PHONE_MAX_LENGTH = 30;

export const onboardingRequestSchema = z.strictObject({
  businessName: z
    .string({ error: 'Enter your business name.' })
    .trim()
    .min(1, 'Enter your business name.')
    .max(BUSINESS_NAME_MAX_LENGTH, `Use at most ${BUSINESS_NAME_MAX_LENGTH} characters.`),
  /** Optional; an empty value means "no phone". */
  contactPhone: z
    .string({ error: 'Enter the phone number as text, like 077 123 4567.' })
    .trim()
    .max(CONTACT_PHONE_MAX_LENGTH, `Use at most ${CONTACT_PHONE_MAX_LENGTH} characters.`)
    .optional()
    .transform((phone) => (phone === undefined || phone === '' ? null : phone)),
  /** Optional; when missing, the API suggests one from the business name. */
  orderPrefix: z
    .string({ error: 'Use 2 to 6 letters or numbers, for example NIM.' })
    .trim()
    .toUpperCase()
    .regex(ORDER_PREFIX_PATTERN, 'Use 2 to 6 letters or numbers, for example NIM.')
    .optional(),
});

/** What the client sends. */
export type OnboardingRequest = z.input<typeof onboardingRequestSchema>;
/** What the API works with after validation (trimmed, prefix uppercased, empty phone → null). */
export type OnboardingInput = z.output<typeof onboardingRequestSchema>;
