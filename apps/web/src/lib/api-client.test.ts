import { describe, expect, it, vi } from 'vitest';
import { createFakeAuth, fakeSession } from '../test/fake-auth';
import { ApiError, createApiClient } from './api-client';
import { strings } from './strings';

const BASE = 'http://api.test/api/v1';

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function setup(reply: () => Response | Promise<Response> = () => json(200, { ok: true })) {
  const auth = createFakeAuth(fakeSession());
  const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(reply()));
  const api = createApiClient({
    baseUrl: BASE,
    auth: auth.client,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const sent = () => {
    const [url, init] = fetch.mock.calls.at(-1) ?? [];
    return { url, init, headers: (init?.headers ?? {}) as Record<string, string> };
  };
  return { auth, fetch, api, sent };
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail.');
}

describe('API client', () => {
  it('sends the current access token as a Bearer token, and no cookies', async () => {
    const { api, sent } = setup();
    await expect(api.get('/me')).resolves.toEqual({ ok: true });
    const { url, init, headers } = sent();
    expect(url).toBe(`${BASE}/me`);
    expect(init?.method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer test-access-token');
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBeUndefined();
    expect(init?.credentials).toBe('omit');
  });

  it('reads the session on every request, so a refreshed token is used', async () => {
    const { api, auth, sent } = setup();
    await api.get('/me');
    auth.emit('TOKEN_REFRESHED', { ...fakeSession(), access_token: 'refreshed-token' });
    await api.get('/me');
    expect(sent().headers.Authorization).toBe('Bearer refreshed-token');
  });

  it('sends JSON bodies and the Idempotency-Key when given', async () => {
    const { api, sent } = setup(() => json(201, { id: 'x' }));
    await api.post('/orders', { note: 'hello' }, { idempotencyKey: 'key-123' });
    const { init, headers } = sent();
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"note":"hello"}');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('key-123');
  });

  it('refuses to call the API without a session', async () => {
    const { api, auth, fetch } = setup();
    auth.emit('SIGNED_OUT', null);
    const error = await caught(api.get('/me'));
    expect(error).toMatchObject({ status: 401, code: 'NOT_SIGNED_IN' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns an API error body into an ApiError with field errors and request ID', async () => {
    const { api } = setup(() =>
      json(400, {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        fieldErrors: { businessName: 'Enter your business name.', bad: 42 },
        requestId: 'req-1',
      }),
    );
    const error = await caught(api.post('/onboarding', {}));
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      fieldErrors: { businessName: 'Enter your business name.' },
      requestId: 'req-1',
    });
  });

  it('never shows server details for a 5xx, and falls back when the body is not ours', async () => {
    const proxy = setup(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'X-Request-Id': 'req-2' },
        }),
    );
    expect(await caught(proxy.api.get('/me'))).toMatchObject({
      status: 502,
      code: 'SERVER_ERROR',
      message: strings.api.serverError,
      requestId: 'req-2',
    });

    const ours = setup(() =>
      json(500, {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        fieldErrors: {},
        requestId: 'req-3',
      }),
    );
    expect(await caught(ours.api.get('/me'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: strings.api.serverError,
    });
  });

  it('reports a network failure plainly', async () => {
    const { api } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await caught(api.get('/me'))).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: strings.api.network,
    });
  });

  it('gives up after the timeout', async () => {
    const auth = createFakeAuth(fakeSession());
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const api = createApiClient({
      baseUrl: BASE,
      auth: auth.client,
      fetch: hang as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(await caught(api.get('/me'))).toMatchObject({
      status: 0,
      code: 'TIMEOUT',
      message: strings.api.timeout,
    });
  });

  it('passes a cancellation by the caller through unchanged', async () => {
    const auth = createFakeAuth(fakeSession());
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const api = createApiClient({
      baseUrl: BASE,
      auth: auth.client,
      fetch: hang as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const request = api.get('/me', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('never calls fetch for a request cancelled before it starts', async () => {
    const { api, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(api.get('/me', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only accepts paths that start with a slash', async () => {
    const { api, fetch } = setup();
    await expect(api.get('https://evil.example/x')).rejects.toThrow(/start with/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
