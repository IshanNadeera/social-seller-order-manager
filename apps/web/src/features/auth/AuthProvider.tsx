import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthClient, Session } from './auth-client';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  /** The Supabase auth client (or a fake in tests). */
  client: AuthClient;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Tracks the Supabase session (docs/DEVELOPMENT.md §11.2). supabase-js keeps the session in browser
 * storage and refreshes the access token on its own; this only mirrors it for the UI.
 * On sign-out, every cached API response is dropped so the next person on this device sees nothing.
 */
export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let active = true;
    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
    };

    // Only synchronous work here: supabase-js warns against awaiting its own calls in this callback.
    const { data } = client.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') queryClient.clear();
      apply(next);
    });
    client
      .getSession()
      .then(({ data: current }) => apply(current.session))
      .catch(() => apply(null));

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client, queryClient]);

  const value = useMemo(() => ({ status, session, client }), [status, session, client]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
