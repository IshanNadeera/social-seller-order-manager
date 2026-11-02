// Checks .github/workflows/ci.yml against docs/DEVELOPMENT.md §13.3, so a later edit cannot quietly
// drop a required step (lint, tests, migrations, builds, audit) or loosen the workflow's safety.
// Run from the repo root: npm run check:ci (part of `npm test`).
// Plain text checks on purpose: no YAML dependency is needed for a handful of rules.
import { existsSync, readFileSync } from 'node:fs';

const WORKFLOW = '.github/workflows/ci.yml';

if (!existsSync(WORKFLOW)) {
  console.error(`✗ ${WORKFLOW} is missing (task A22).`);
  process.exit(1);
}

const text = readFileSync(WORKFLOW, 'utf8');
const lines = text.split(/\r?\n/);
const code = lines.filter((line) => !line.trim().startsWith('#')).join('\n');
const errors = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
};

// Triggers and permissions
check(/^on:\s*$/m.test(code) && /^\s+pull_request:/m.test(code), 'must run on pull_request');
check(/^\s+push:\s*\n\s+branches:\s*\[\s*main\s*\]/m.test(code), 'must run on push to main');
check(
  /^permissions:\s*\n\s+contents:\s*read\s*$/m.test(code),
  'top-level permissions must be contents: read',
);
check(
  !/\$\{\{\s*secrets\./.test(code),
  'CI must not use repository secrets (no real credentials in tests)',
);
check(
  !/SERVICE_ROLE|SUPABASE_SECRET/i.test(code),
  'the Supabase service-role / secret key must never appear',
);

// Every action pinned to a full commit SHA
for (const [index, line] of lines.entries()) {
  const match = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
  if (match && !/@[0-9a-f]{40}$/.test(match[1])) {
    errors.push(`line ${index + 1}: ${match[1]} must be pinned to a full commit SHA`);
  }
}
check(
  (code.match(/actions\/setup-node@/g) ?? []).length ===
    (code.match(/node-version-file:\s*\.nvmrc/g) ?? []).length,
  'every setup-node step must read the Node version from .nvmrc',
);
check(!/npm install\b/.test(code), 'use npm ci (exact lockfile), never npm install');

// Required commands (§13.3)
const required = [
  'npm ci',
  'npm run lint',
  'npm run format:check',
  'npm run typecheck',
  'npm test',
  'npm run db:deploy -w apps/api',
  'npm run test:db -w apps/api',
  'npm run db:check-drift -w apps/api',
  'npm run build -w apps/web',
  'npm run build -w apps/api',
  'npm audit --audit-level=high',
];
for (const command of required) {
  check(code.includes(`run: ${command}`), `missing step: run: ${command}`);
}

// Integration job: a PostgreSQL service, and roles → migrations → tests, in that order.
check(
  /services:\s*\n\s+postgres:\s*\n\s+(#.*\n\s+)?image:\s*postgres:\d+/m.test(text),
  'integration needs a postgres:<major> service',
);
const roles = code.indexOf('scripts/ci/supabase-roles.sql');
const deploy = code.indexOf('npm run db:deploy -w apps/api');
const dbTests = code.indexOf('npm run test:db -w apps/api');
const rls = code.indexOf('scripts/ci/check-rls.sql');
const drift = code.indexOf('npm run db:check-drift -w apps/api');
check(
  roles !== -1 && existsSync('scripts/ci/supabase-roles.sql'),
  'the Supabase roles must be created (scripts/ci/supabase-roles.sql)',
);
// A23 (ADR-004): the RLS gate and the drift gate run on the freshly migrated database.
check(
  rls !== -1 &&
    existsSync('scripts/ci/check-rls.sql') &&
    /psql -v ON_ERROR_STOP=1 .*scripts\/ci\/check-rls\.sql/.test(code),
  'the RLS gate must run scripts/ci/check-rls.sql with psql -v ON_ERROR_STOP=1',
);
check(
  roles < deploy && deploy < rls && rls < drift && drift < dbTests,
  'order must be: create roles → migrate deploy → RLS check → drift check → database tests',
);

if (errors.length) {
  console.error(errors.map((error) => `✗ ${WORKFLOW}: ${error}`).join('\n'));
  process.exit(1);
}
console.log('CI workflow check passed');
