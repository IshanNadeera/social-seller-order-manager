// Validated API environment (docs/DEVELOPMENT.md §10.4). Parsed once at startup in main.ts;
// the app fails fast with a list of problems instead of starting half-configured.
// Code reads settings through the ENV provider (env.module.ts), never from process.env directly.
import { z } from 'zod';

/** Variables that must never reach this API (§10.4: the design does not need the service-role key). */
const FORBIDDEN_VARIABLE = /SERVICE_ROLE|SUPABASE_SECRET/i;

function isExactOrigin(value: string): boolean {
  if (value.includes('*')) return false; // the URL parser accepts "*" in host names
  try {
    const url = new URL(value);
    // Comparing with url.origin rejects paths, trailing slashes, credentials and default ports.
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const origin = (example: string) =>
  z.string().refine(isExactOrigin, {
    message: `Must be an exact origin such as ${example}: scheme, host and optional port; no path, no trailing slash, no wildcard.`,
  });

const httpUrl = z
  .url({ protocol: /^https?$/, message: 'Must be an http(s) URL.' })
  .refine((value) => !value.endsWith('/'), { message: 'Must not end with a slash.' });

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  message: 'Must be a postgresql:// connection string.',
});

// One check with one message (chained Zod checks would report "abc" twice).
const port = z.string().transform((value, ctx) => {
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    ctx.addIssue({ code: 'custom', message: 'Must be a whole number from 1 to 65535.' });
    return z.NEVER;
  }
  return parsed;
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Runtime connection through the Supabase pooler, used by the Prisma pg adapter (A9). */
    DATABASE_URL: postgresUrl,
    /** Used to fetch the JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (A13). */
    SUPABASE_URL: origin('https://abcdefgh.supabase.co'),
    /** Expected `iss` claim of Supabase access tokens: `${SUPABASE_URL}/auth/v1`. */
    SUPABASE_JWT_ISSUER: httpUrl,
    /** The only origin CORS allows. */
    WEB_ORIGIN: origin('https://app.example.com'),
    /** Error monitoring (F5). Optional until then. */
    SENTRY_DSN: httpUrl.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['SUPABASE_URL', 'SUPABASE_JWT_ISSUER', 'WEB_ORIGIN'] as const) {
      const value: unknown = env[key];
      if (typeof value === 'string' && !value.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Must use https in production.' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Thrown when the environment is invalid. The message names variables, never their values. */
export class EnvValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid environment configuration. Fix these variables (see apps/api/.env.example):\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates the environment and returns typed settings. Empty values count as missing.
 * Unknown variables are ignored, except anything that looks like a Supabase service-role or secret key.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );

  const problems = Object.keys(present)
    .filter((key) => FORBIDDEN_VARIABLE.test(key))
    .map(
      (key) =>
        `${key}: Remove it. The API must not hold a Supabase service-role or secret key (docs/DEVELOPMENT.md §10.4).`,
    );

  const result = envSchema.safeParse(present);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '(environment)';
      problems.push(key in present ? `${key}: ${issue.message}` : `${key}: Required.`);
    }
  }

  if (problems.length > 0 || !result.success) throw new EnvValidationError(problems);
  return result.data;
}
