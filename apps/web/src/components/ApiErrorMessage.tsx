import { isApiError } from '../lib/api-client';
import { strings } from '../lib/strings';

/** Plain-language text for any error from the API client, plus the reference number if there is one. */
export function apiErrorText(error: unknown): { message: string; reference: string | null } {
  if (isApiError(error)) {
    return {
      message: error.message,
      reference: error.requestId ? strings.api.reference(error.requestId) : null,
    };
  }
  return { message: strings.api.generic, reference: null };
}

/** The message, and a small reference line sellers can quote to support (§9.7). */
export function ApiErrorMessage({ error }: { error: unknown }) {
  const { message, reference } = apiErrorText(error);
  return (
    <>
      <p>{message}</p>
      {reference && <p className="mt-1 text-xs opacity-80">{reference}</p>}
    </>
  );
}
