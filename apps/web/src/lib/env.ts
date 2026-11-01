// The web app's public settings (docs/DEVELOPMENT.md §10.4), checked once at startup so a missing
// or malformed value fails with a clear message instead of a confusing network error later.
// Only public values belong here: everything in import.meta.env ships to the browser.
import { z } from 'zod';

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .transform((url) => url.replace(/\/+$/, '')); // no trailing slash, so paths join cleanly

const webEnvSchema = z.object({
  VITE_API_URL: httpUrl,
  VITE_SUPABASE_URL: httpUrl,
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(20),
});

export interface WebEnv {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Validates the VITE_ variables. Error messages name variables, never values. */
export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new Error(
      `The web app's settings are missing or invalid: ${names.join(', ')}. ` +
        'Copy apps/web/.env.example to apps/web/.env and fill in the values.',
    );
  }
  return {
    apiUrl: result.data.VITE_API_URL,
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabaseAnonKey: result.data.VITE_SUPABASE_ANON_KEY,
  };
}
