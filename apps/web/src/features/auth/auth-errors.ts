// Turns Supabase Auth errors into plain-language messages (docs/DEVELOPMENT.md §6.9).
// Supabase's own messages are technical and English-only, so they are never shown directly.
import { strings } from '../../lib/strings';

const messages = strings.auth.errors;

/** Supabase error codes we explain specifically; anything else gets the generic message. */
const BY_CODE: Record<string, string> = {
  invalid_credentials: messages.invalidCredentials,
  email_not_confirmed: messages.emailNotConfirmed,
  weak_password: messages.weakPassword,
  same_password: messages.samePassword,
  over_request_rate_limit: messages.tooManyRequests,
  over_email_send_rate_limit: messages.tooManyRequests,
  otp_expired: messages.linkExpired,
  signup_disabled: messages.signUpDisabled,
  email_provider_disabled: messages.signUpDisabled,
};

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
}

/** The Supabase error code, if there is one. */
export function authErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : undefined;
}

export function authErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  if (code !== undefined && code in BY_CODE) return BY_CODE[code] ?? messages.generic;
  if (typeof error === 'object' && error !== null) {
    const { name, status } = error as ErrorLike;
    // supabase-js reports a failed fetch (offline, DNS, server down) as AuthRetryableFetchError.
    if (name === 'AuthRetryableFetchError' || status === 0) return messages.network;
    if (status === 429) return messages.tooManyRequests;
  }
  if (error instanceof TypeError) return messages.network; // fetch itself failed
  return messages.generic;
}
