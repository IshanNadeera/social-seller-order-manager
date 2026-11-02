// Checks docs/adr against docs/DEVELOPMENT.md §21: one file per decision, ADR-001 to ADR-019 all
// present, numbers unique and without gaps, every required section and a valid status and date,
// and every ADR listed in docs/adr/README.md.
// Run from the repo root: npm run check:adr (part of `npm test`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const DIR = 'docs/adr';
const REQUIRED_FROM_BLUEPRINT = 19; // §21 lists ADR-001 to ADR-019
const SECTIONS = ['Context', 'Options considered', 'Decision', 'Reason', 'Consequences'];
const STATUS = /^(Proposed|Accepted|Deprecated|Superseded by ADR-\d{3})\b/;
const FILE = /^(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const errors = [];
if (!existsSync(DIR)) {
  console.error(`✗ ${DIR} is missing`);
  process.exit(1);
}

const entries = readdirSync(DIR).filter((name) => name !== 'README.md' && !name.startsWith('.'));
const numbers = new Map();
for (const name of entries) {
  const match = FILE.exec(name);
  if (!match) {
    errors.push(`${name}: file names must look like 001-short-slug.md`);
    continue;
  }
  const number = Number(match[1]);
  if (numbers.has(number))
    errors.push(`${name}: ADR-${match[1]} is used twice (also ${numbers.get(number)})`);
  numbers.set(number, name);
}

const highest = Math.max(REQUIRED_FROM_BLUEPRINT, ...numbers.keys());
for (let number = 1; number <= highest; number += 1) {
  if (!numbers.has(number))
    errors.push(`ADR-${String(number).padStart(3, '0')} is missing (numbers have no gaps)`);
}

const index = existsSync(`${DIR}/README.md`) ? readFileSync(`${DIR}/README.md`, 'utf8') : '';
if (index === '') errors.push(`${DIR}/README.md (the index) is missing`);

for (const [number, name] of [...numbers].sort((a, b) => a[0] - b[0])) {
  const id = `ADR-${String(number).padStart(3, '0')}`;
  const text = readFileSync(`${DIR}/${name}`, 'utf8');
  const where = `${DIR}/${name}`;

  if (!new RegExp(`^# ${id}: \\S`).test(text))
    errors.push(`${where}: first line must be "# ${id}: <title>"`);

  const status = /^- Status: (.+)$/m.exec(text)?.[1];
  if (!status || !STATUS.test(status)) {
    errors.push(
      `${where}: "- Status:" must be Proposed, Accepted, Deprecated or "Superseded by ADR-NNN"`,
    );
  }
  const superseded = /Superseded by (ADR-\d{3})/.exec(status ?? '')?.[1];
  if (superseded && !numbers.has(Number(superseded.slice(4)))) {
    errors.push(`${where}: superseded by ${superseded}, which does not exist`);
  }

  const date = /^- Date: (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1];
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    errors.push(`${where}: "- Date: YYYY-MM-DD" is missing or invalid`);
  }
  if (!/^- Blueprint: \S/m.test(text))
    errors.push(`${where}: "- Blueprint:" (the sections it rests on) is missing`);

  let previous = -1;
  for (const section of SECTIONS) {
    const match = new RegExp(`^## ${section}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(
      text,
    );
    if (!match) {
      errors.push(`${where}: section "## ${section}" is missing`);
      continue;
    }
    if (match[1].trim().length < 20) errors.push(`${where}: section "## ${section}" is empty`);
    if (match.index < previous) errors.push(`${where}: "## ${section}" is out of order`);
    previous = match.index;
  }

  if (!index.includes(`](${name})`))
    errors.push(`${DIR}/README.md: ${id} (${name}) is not in the index`);
}

if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join('\n'));
  process.exit(1);
}
console.log(`ADR check passed (${numbers.size} decisions)`);
