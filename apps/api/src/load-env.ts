// Loads apps/api/.env for local development, if the file exists.
// Variables already set in the environment win, so hosted environments are unaffected.
// Must be the first import in main.ts. Task A7 adds full validation with Zod.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
