// Checks the npm workspaces setup from docs/DEVELOPMENT.md §10.1 and ADR-002.
// Run from the repo root: npm run check:workspaces
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const root = read('package.json');
const want = ['apps/*', 'packages/*'];
if (JSON.stringify(root.workspaces) !== JSON.stringify(want)) {
  errors.push(`package.json workspaces should be ${JSON.stringify(want)}`);
}
if (root.private !== true) errors.push('Root package.json must be "private": true');

const nvmrc = existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : '';
if (!/^\d+$/.test(nvmrc)) errors.push('.nvmrc must contain a single Node major, e.g. 24');
const engine = root.engines?.node ?? '';
if (!engine.startsWith(`>=${nvmrc}.`) || !engine.endsWith(`<${Number(nvmrc) + 1}`)) {
  errors.push(
    `engines.node (${engine || 'missing'}) does not match .nvmrc (${nvmrc || 'missing'})`,
  );
}
const running = process.versions.node.split('.')[0];
if (running !== nvmrc)
  errors.push(`Running Node ${process.versions.node}, but .nvmrc pins ${nvmrc}. Run: nvm use`);

if (!existsSync('package-lock.json')) {
  errors.push('package-lock.json is missing. Run npm install and commit it');
} else {
  const lock = read('package-lock.json');
  for (const ws of ['apps/web', 'apps/api', 'packages/shared']) {
    if (!lock.packages?.[ws]) errors.push(`package-lock.json does not include workspace ${ws}`);
  }
}

for (const [dir, name] of [
  ['apps/web', '@ssom/web'],
  ['apps/api', '@ssom/api'],
  ['packages/shared', '@ssom/shared'],
]) {
  const p = `${dir}/package.json`;
  if (!existsSync(p)) {
    errors.push(`Missing ${p}`);
    continue;
  }
  const pkg = read(p);
  if (pkg.name !== name) errors.push(`${p} should be named ${name}`);
  if (pkg.private !== true) errors.push(`${p} must be "private": true`);
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log('Workspaces check passed');
