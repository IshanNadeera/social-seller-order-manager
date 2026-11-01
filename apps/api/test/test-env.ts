// A valid environment for tests, built through the real parser so it can never drift from the schema.
// Fake local values only.
import { parseEnv } from '../src/common/env';

export const testEnvSource = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  WEB_ORIGIN: 'http://localhost:5173',
} as const;

export const testEnv = parseEnv(testEnvSource);
