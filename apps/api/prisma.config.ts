// Prisma CLI configuration (migrate, generate, validate, studio). Prisma 7. See docs/DEVELOPMENT.md §8.4, §10.4.
// The running API does not use this file: it connects with DATABASE_URL through the PrismaPg adapter.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files itself. Variables already set in the environment win.
// Run Prisma from apps/api (npm run <script> -w apps/api), like the API's own src/load-env.ts.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Migrations need a session-level connection (direct, or Supavisor session pooler), never the
// transaction pooler. Commands that do not touch the database (generate, validate) must still work
// without it, for example in CI right after `npm ci`, so a missing value is left empty here and
// Prisma reports it only when a command actually needs the database.
const directUrl = process.env.DIRECT_URL ?? '';
if (directUrl !== '' && !/^postgres(ql)?:\/\//.test(directUrl)) {
  throw new Error(
    'DIRECT_URL must be a postgresql:// connection string (see apps/api/.env.example).',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Fake demo data for local development (prisma/seed.ts). Run: npm run db:seed -w apps/api
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: directUrl,
  },
});
