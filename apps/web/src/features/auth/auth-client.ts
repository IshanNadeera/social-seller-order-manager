// The part of supabase-js's auth client the web app uses. Components receive it through
// AuthProvider, so tests can pass a fake and never need a Supabase server.
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

export type AuthClient = Pick<
  SupabaseClient['auth'],
  | 'getSession'
  | 'onAuthStateChange'
  | 'signInWithPassword'
  | 'signUp'
  | 'signOut'
  | 'resend'
  | 'resetPasswordForEmail'
  | 'verifyOtp'
  | 'updateUser'
>;

export type { AuthError };
export type { AuthChangeEvent, Session } from '@supabase/supabase-js';
