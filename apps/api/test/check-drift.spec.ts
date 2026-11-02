// Unit tests for the migration drift gate's decisions (scripts/check-drift.ts). The real comparison
// runs in CI against the freshly migrated database (.github/workflows/ci.yml, task A23).
import { describe, expect, it } from 'vitest';
import { DIFF_ARGS, describeDiff } from '../scripts/check-drift';

describe('migration drift check', () => {
  it('compares the migrated database with schema.prisma and asks for an exit code', () => {
    expect(DIFF_ARGS).toEqual([
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
      '--exit-code',
    ]);
  });

  it('passes when there is no difference (exit 0)', () => {
    expect(describeDiff(0, '-- This is an empty migration.', '')).toMatchObject({ ok: true });
  });

  it('fails with the missing SQL and the command to fix it when the schema drifted (exit 2)', () => {
    const sql = 'ALTER TABLE "app"."customers" ADD COLUMN "nickname" TEXT;';
    const result = describeDiff(2, `${sql}\n`, '');
    expect(result.ok).toBe(false);
    expect(result.message).toContain(sql);
    expect(result.message).toContain('npm run db:migrate -w apps/api -- --name');
  });

  it('fails clearly when Prisma itself cannot run (any other exit)', () => {
    const result = describeDiff(1, '', "Error: P1001: Can't reach database server");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not run \(exit 1\)/);
    expect(result.message).toContain('P1001');
  });

  it('never treats a killed process as a pass', () => {
    expect(describeDiff(null, '', '').ok).toBe(false);
  });
});
