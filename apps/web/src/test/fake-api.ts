// A fake API behind a fake fetch(), for screen tests. The real API client runs on top of it, so a
// test can check exactly what was sent (method, path, headers, body).
import type { ApiErrorBody, MeResponse } from '@ssom/shared';
import { vi } from 'vitest';

export const TEST_API_URL = 'http://api.test/api/v1';
export const TEST_REQUEST_ID = 'req-test-0001';

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status: number;
  body?: unknown;
}

type Handler = (call: RecordedCall) => FakeReply | Promise<FakeReply>;

export const TEST_BUSINESS_ID = '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';

/** GET /me for a seller who has finished onboarding. */
export function memberMe(overrides: Partial<MeResponse['business']> = {}): MeResponse {
  return {
    user: { id: '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b', email: 'seller@example.test' },
    needsOnboarding: false,
    role: 'OWNER',
    business: {
      id: TEST_BUSINESS_ID,
      name: 'Nimali Fashions',
      orderPrefix: 'NIM',
      currency: 'LKR',
      timezone: 'Asia/Colombo',
      ...overrides,
    },
  };
}

/** GET /me for a seller who has signed up but has no business yet. */
export function newcomerMe(): MeResponse {
  return { ...memberMe(), needsOnboarding: true, role: null, business: null };
}

export function errorReply(status: number, code: string, message: string, fieldErrors: Record<string, string> = {}): FakeReply {
  const body: ApiErrorBody = { code, message, fieldErrors, requestId: TEST_REQUEST_ID };
  return { status, body };
}

export function createFakeApi(options: { me?: MeResponse } = {}) {
  const calls: RecordedCall[] = [];
  const handlers = new Map<string, Handler>();
  const on = (method: string, path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
  };
  on('GET', '/me', () => ({ status: 200, body: options.me ?? memberMe() }));

  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.href.startsWith(TEST_API_URL)) throw new TypeError(`Unexpected URL ${url.href}`);
    const call: RecordedCall = {
      method: init.method ?? 'GET',
      path: url.pathname.slice(new URL(TEST_API_URL).pathname.length) + url.search,
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const handler = handlers.get(`${call.method} ${call.path}`);
    const reply = handler ? await handler(call) : errorReply(404, 'NOT_FOUND', 'Not found.');
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': TEST_REQUEST_ID },
    });
  });

  return { fetch: fetch as unknown as typeof globalThis.fetch, fetchMock: fetch, calls, on };
}

export type FakeApi = ReturnType<typeof createFakeApi>;
