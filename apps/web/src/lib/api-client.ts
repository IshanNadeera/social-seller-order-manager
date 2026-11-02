// The one way the web app talks to the API (docs/DEVELOPMENT.md §9). Every request carries the
// current Supabase access token as a Bearer token; there are no cookies (§11.2). Errors come back
// as ApiError in the API's own shape { code, message, fieldErrors, requestId } (§9.7).
import type { ApiErrorBody } from '@ssom/shared';
import type { AuthClient } from '../features/auth/auth-client';
import { strings } from './strings';

/** Slow 3G is a target (§6.9), so be patient, but never hang forever. */
export const API_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 when no response arrived (offline, timeout). */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    /** Quote this when reporting a problem: it finds the server's log line. */
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Required by the API on order, payment and COD-settlement creation (§9.8). */
  idempotencyKey?: string;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
}

export interface ApiClientConfig {
  /** e.g. http://localhost:3000/api/v1 (no trailing slash). */
  baseUrl: string;
  /** Where the access token comes from. supabase-js refreshes it before it expires. */
  auth: Pick<AuthClient, 'getSession'>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const m = strings.api;

/** Fallback messages for errors that did not come with one of our error bodies. */
function defaultError(status: number): { code: string; message: string } {
  if (status === 401) return { code: 'UNAUTHORIZED', message: m.unauthorized };
  if (status === 403) return { code: 'FORBIDDEN', message: m.forbidden };
  if (status === 404) return { code: 'NOT_FOUND', message: m.notFound };
  if (status === 429) return { code: 'RATE_LIMITED', message: m.rateLimited };
  if (status >= 500) return { code: 'SERVER_ERROR', message: m.serverError };
  return { code: 'REQUEST_FAILED', message: m.generic };
}

function isErrorBody(
  value: unknown,
): value is Partial<ApiErrorBody> & { code: string; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return typeof code === 'string' && typeof message === 'string';
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** A request cancelled by its caller fails as fetch() would: with the signal's reason (an AbortError). */
function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('The request was cancelled.', 'AbortError');
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  // Called through a wrapper so the browser's fetch is never invoked with a foreign `this`.
  const fetchImpl: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = config.timeoutMs ?? API_TIMEOUT_MS;

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith('/')) throw new Error(`API paths start with "/": ${path}`);

    throwIfCancelled(options.signal);
    // Read the session for every request, so a refreshed token is always the one sent.
    const { data } = await config.auth.getSession();
    // The caller may have cancelled while the session was read. A signal that is already aborted
    // never fires 'abort' again, so check now; otherwise the request would run on until the timeout.
    throwIfCancelled(options.signal);
    const token = data.session?.access_token;
    if (!token) throw new ApiError(401, 'NOT_SIGNED_IN', m.unauthorized);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

    // Our own timeout, combined with the caller's signal (TanStack Query cancels stale requests).
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error; // cancelled by the caller: not a failure to report
      throw timedOut
        ? new ApiError(0, 'TIMEOUT', m.timeout)
        : new ApiError(0, 'NETWORK_ERROR', m.network);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }

    const headerRequestId = response.headers.get('X-Request-Id');
    if (response.status === 204) return undefined as T;
    const parsed: unknown = await response.json().catch(() => null);
    if (response.ok) return parsed as T;

    if (isErrorBody(parsed)) {
      throw new ApiError(
        response.status,
        parsed.code,
        // 5xx messages are generic by design (§9.7); 4xx messages are written for sellers.
        response.status >= 500 ? m.serverError : parsed.message,
        stringRecord(parsed.fieldErrors),
        typeof parsed.requestId === 'string' ? parsed.requestId : headerRequestId,
      );
    }
    const fallback = defaultError(response.status);
    throw new ApiError(response.status, fallback.code, fallback.message, {}, headerRequestId);
  }

  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
    patch: (path, body, options) => request('PATCH', path, body, options),
    delete: (path, options) => request('DELETE', path, undefined, options),
  };
}
