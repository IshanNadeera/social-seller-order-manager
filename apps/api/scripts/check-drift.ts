// Migration drift gate (docs/DEVELOPMENT.md §8.3, §13.3): fails when prisma/schema.prisma describes
// a database that the migrations do not build, i.e. the schema was changed without a migration.
//
// Run after `prisma migrate deploy`, against the database the migrations just built:
//   npm run db:check-drift -w apps/api
// It compares that database (the datasource in prisma.config.ts, i.e. DIRECT_URL) with the schema.
// Prisma 7 has no --shadow-database-url, and this way needs no shadow database at all.
// Hand-written SQL (CHECK constraints, partial indexes, RLS, grants) is invisible to Prisma, so it never
// shows up as drift; everything Prisma models does.
import { spawnSync } from 'node:child_process';

export const DIFF_ARGS = [
  'migrate',
  'diff',
  '--from-config-datasource',
  '--to-schema',
  'prisma/schema.prisma',
  '--script',
  '--exit-code',
] as const;

export interface DriftResult {
  ok: boolean;
  message: string;
}

/** Turns `prisma migrate diff --exit-code` output into a verdict. Exit codes: 0 = same, 2 = differs, else error. */
export function describeDiff(status: number | null, stdout: string, stderr: string): DriftResult {
  if (status === 0) {
    return {
      ok: true,
      message: 'Migration drift check passed: the migrations build exactly schema.prisma.',
    };
  }
  if (status === 2) {
    return {
      ok: false,
      message: [
        'schema.prisma has changes that no migration contains. The migrations are missing this SQL:',
        '',
        stdout.trim(),
        '',
        'Create the migration locally, review its SQL, and commit it with the schema change:',
        '  npm run db:migrate -w apps/api -- --name <short_description>',
      ].join('\n'),
    };
  }
  return {
    ok: false,
    message: [
      `prisma migrate diff could not run (exit ${status ?? 'signal'}). Is DIRECT_URL set, and has`,
      '`npm run db:deploy -w apps/api` been run against that database?',
      stderr.trim(),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function main(): void {
  const result = spawnSync('npx', ['--no-install', 'prisma', ...DIFF_ARGS], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const verdict = describeDiff(result.status, result.stdout ?? '', result.stderr ?? '');
  if (verdict.ok) {
    console.log(verdict.message);
    return;
  }
  console.error(verdict.message);
  process.exitCode = 1;
}

// Run only when executed directly (tsx scripts/check-drift.ts), not when imported by a test.
if (process.argv[1]?.endsWith('check-drift.ts')) main();
