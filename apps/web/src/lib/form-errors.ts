// Server-side field errors (§9.7 `fieldErrors`) shown next to their fields, like the browser's own.
import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';
import { isApiError } from './api-client';

/** True when the API blamed one of `fields` (shown next to the field instead of in an alert). */
export function hasServerFieldError(error: unknown, fields: readonly string[]): boolean {
  if (!isApiError(error)) return false;
  const { fieldErrors } = error;
  return fields.some((field) => fieldErrors[field] !== undefined);
}

/** Puts the API's message for each of `fields` on that field of the form. */
export function applyServerFieldErrors<Values extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<Values>,
  fields: readonly FieldPath<Values>[],
): void {
  if (!isApiError(error)) return;
  for (const field of fields) {
    const message = error.fieldErrors[field];
    if (message !== undefined) setError(field, { type: 'server', message });
  }
}
