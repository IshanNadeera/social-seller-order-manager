// Guards the Prisma schema rules from docs/DEVELOPMENT.md §8.1 and §8.4, so a new model can never
// land in the exposed `public` schema and the client keeps building for CommonJS.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  // Drop comments so commented-out code cannot satisfy or break a rule.
  .replace(/\/\/.*$/gm, '');

/** Returns the body of each top-level `<keyword> <Name> { … }` block. */
function blocks(keyword: 'model' | 'enum' | 'view' | 'type'): { name: string; body: string }[] {
  const pattern = new RegExp(`^${keyword}\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}`, 'gm');
  return [...schema.matchAll(pattern)].map((match) => ({
    name: match[1] ?? '',
    body: match[2] ?? '',
  }));
}

function block(keyword: 'generator' | 'datasource', name: string): string {
  const match = new RegExp(`^${keyword}\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  return match?.[1] ?? '';
}

describe('prisma/schema.prisma', () => {
  it('uses the Prisma 7 client generator, built for CommonJS into src/generated/prisma', () => {
    const generator = block('generator', 'client');
    expect(generator).toMatch(/provider\s*=\s*"prisma-client"/);
    expect(generator).toMatch(/output\s*=\s*"\.\.\/src\/generated\/prisma"/);
    expect(generator).toMatch(/moduleFormat\s*=\s*"cjs"/);
  });

  it('targets PostgreSQL and only the private app schema', () => {
    const datasource = block('datasource', 'db');
    expect(datasource).toMatch(/provider\s*=\s*"postgresql"/);
    expect(datasource).toMatch(/schemas\s*=\s*\[\s*"app"\s*\]/);
  });

  it('keeps connection URLs out of the schema (they belong in prisma.config.ts and env)', () => {
    expect(block('datasource', 'db')).not.toMatch(/\b(url|directUrl|shadowDatabaseUrl)\s*=/);
  });

  it.each(['model', 'enum', 'view'] as const)('puts every %s in the app schema', (keyword) => {
    for (const { name, body } of blocks(keyword)) {
      expect(body, `${keyword} ${name} must declare @@schema("app")`).toMatch(
        /@@schema\(\s*"app"\s*\)/,
      );
    }
  });
});
