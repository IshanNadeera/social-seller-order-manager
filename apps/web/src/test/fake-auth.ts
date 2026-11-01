// A stand-in for supabase-js's auth client, so screens can be tested without a Supabase server.
// It keeps one session in memory and notifies listeners the way supabase-js does.
import { vi } from 'vitest';
import type { AuthChangeEvent, AuthClient, Session } from '../features/auth/auth-client';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

/** An AuthError-like value, as supabase-js returns it. */
export function authError(code: string, status = 400) {
  return Object.assign(new Error(code), { name: 'AuthApiError', code, status, __isAuthError: true });
}

export function fakeSession(email = 'seller@example.test'): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b',
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const ok = <T>(data: T) => Promise.resolve({ data, error: null });

export function createFakeAuth(initial: Session | null = null) {
  let session = initial;
  const listeners = new Set<Listener>();

  /** Changes the session and tells listeners, as supabase-js does after sign-in/out. */
  const emit = (event: AuthChangeEvent, next: Session | null) => {
    session = next;
    for (const listener of listeners) listener(event, next);
  };

  const fns = {
    getSession: vi.fn(() => ok({ session })),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener);
      return { data: { subscription: { id: 'fake', callback: listener, unsubscribe: () => listeners.delete(listener) } } };
    }),
    signInWithPassword: vi.fn((_: { email: string; password: string }) => {
      const next = fakeSession();
      emit('SIGNED_IN', next);
      return ok({ user: next.user, session: next });
    }),
    signUp: vi.fn((_: { email: string; password: string }) => ok({ user: null, session: null })),
    signOut: vi.fn((_?: { scope?: string }) => {
      emit('SIGNED_OUT', null);
      return Promise.resolve({ error: null });
    }),
    resend: vi.fn((_: { type: string; email: string }) => ok({ user: null, session: null })),
    resetPasswordForEmail: vi.fn((_: string) => ok({})),
    verifyOtp: vi.fn((_: { token_hash: string; type: string }) => {
      const next = fakeSession();
      emit('SIGNED_IN', next);
      return ok({ user: next.user, session: next });
    }),
    updateUser: vi.fn((_: { password: string }) => ok({ user: session?.user ?? null })),
  };

  return {
    ...fns,
    emit,
    /** The fake, typed as the real client for AppProviders. */
    client: fns as unknown as AuthClient,
  };
}

export type FakeAuth = ReturnType<typeof createFakeAuth>;
