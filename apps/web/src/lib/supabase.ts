// The only place the web app creates a Supabase client (docs/DEVELOPMENT.md §10.1, §23 rule 9).
// It exports the AUTH client only: the browser never queries application tables, and ESLint
// forbids importing @supabase/supabase-js anywhere else (type imports aside).
import { createClient } from '@supabase/supabase-js';
import type { AuthClient } from '../features/auth/auth-client';
import { parseWebEnv } from './env';

export const webEnv = parseWebEnv(import.meta.env);

const client = createClient(webEnv.supabaseUrl, webEnv.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Email links open /auth/confirm?token_hash=…, which calls verifyOtp (a POST). Tokens are never
    // put in a URL, so nothing needs to be read from the address bar, and the links work in any
    // browser or device, not only the one that asked for them (as PKCE redirects would require).
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

export const supabaseAuth: AuthClient = client.auth;
