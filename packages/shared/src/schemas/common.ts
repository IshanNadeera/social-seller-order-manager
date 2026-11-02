// Building blocks shared by the request schemas (ADR-024). Internal helpers plus the paging limits.
import { z } from 'zod';

/** §6.3 / §9.5: default 25 per page, never more than 100. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Longest search text accepted by list endpoints. */
export const SEARCH_MAX_LENGTH = 100;

/** "" or only spaces → null, so a cleared form field clears the value. */
export const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Optional text: trimmed, blank becomes null, at most `max` characters. */
export const optionalText = (max: number, message = `Use at most ${max} characters.`) =>
  z.preprocess(blankToNull, z.string().trim().max(max, message).nullable().optional());

/** Required text: trimmed, at least one character, at most `max`. */
export const requiredText = (max: number, missing: string) =>
  z.string({ error: missing }).trim().min(1, missing).max(max, `Use at most ${max} characters.`);

/**
 * For "send only what changes" bodies: an empty one is refused as a whole. Checked only when every
 * field is valid: zod leaves a failing field out of the value, so `{ name: "" }` would otherwise look
 * empty too and get a second, misleading error.
 */
export const changesSomething = (input: Record<string, unknown>) =>
  Object.values(input).some((value) => value !== undefined);
export const changeAtLeastOneField = {
  message: 'Change at least one field.',
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

const pageNumber = z.coerce
  .number({ error: 'Must be a whole number.' })
  .int('Must be a whole number.')
  .min(1, 'Must be 1 or more.');

/**
 * Query-string fields of a searchable, paged list (values arrive as strings): `q` (blank → none),
 * `page`, `pageSize` and `includeArchived`. Spread into a strictObject.
 */
export const searchListQueryFields = {
  q: z
    .string()
    .trim()
    .max(SEARCH_MAX_LENGTH, `Use at most ${SEARCH_MAX_LENGTH} characters.`)
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
};
