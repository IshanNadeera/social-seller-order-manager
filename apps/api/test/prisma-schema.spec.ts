// Guards the Prisma schema rules from docs/DEVELOPMENT.md §8.1, §8.2 and §8.4: tables in the private
// app schema, money as NUMERIC(12,2), and tenant isolation through composite foreign keys.
// The database-level checks (CHECK constraints, RLS) are tested against a real database in A11.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  // Drop comments (// and ///) so commented-out code cannot satisfy or break a rule.
  .replace(/\/\/.*$/gm, '');

interface Block {
  name: string;
  body: string;
}

/** Top-level `<keyword> <Name> { … }` blocks. */
function blocks(keyword: 'model' | 'enum' | 'view' | 'type'): Block[] {
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

interface Field {
  name: string;
  type: string;
  line: string;
}

/** Field lines of a model: `name Type[?|[]] attributes…` (block attributes start with @@). */
function fields(model: Block): Field[] {
  return model.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('@@'))
    .map((line) => {
      const [name = '', type = ''] = line.split(/\s+/);
      return { name, type: type.replace(/[?[\]]/g, ''), line };
    });
}

function list(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const models = blocks('model');
const modelNamed = (name: string) => models.find((model) => model.name === name);

/** The 13 tables of §8.2/§8.4 (subscriptions is deferred until paid launch). */
const TABLES: Record<string, string> = {
  User: 'users',
  Business: 'businesses',
  BusinessCounter: 'business_counters',
  BusinessMember: 'business_members',
  Customer: 'customers',
  CustomerAddress: 'customer_addresses',
  Product: 'products',
  Order: 'orders',
  OrderItem: 'order_items',
  Payment: 'payments',
  Delivery: 'deliveries',
  OrderEvent: 'order_events',
  IdempotencyKey: 'idempotency_keys',
};

/** Tenant-owned tables: have business_id and are referenced by (business_id, id) (§8.1). */
const TENANT_MODELS = [
  'Customer',
  'CustomerAddress',
  'Product',
  'Order',
  'OrderItem',
  'Payment',
  'Delivery',
  'OrderEvent',
];

describe('prisma/schema.prisma: setup', () => {
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

describe('prisma/schema.prisma: tables', () => {
  it('has exactly the tables from §8.4', () => {
    expect(models.map((model) => model.name).sort()).toEqual(Object.keys(TABLES).sort());
  });

  it.each(Object.entries(TABLES))('maps %s to the snake_case table %s', (model, table) => {
    expect(modelNamed(model)?.body).toMatch(new RegExp(`@@map\\("${table}"\\)`));
  });

  it('maps every multi-word field to a snake_case column', () => {
    for (const model of models) {
      for (const field of fields(model)) {
        const isRelation =
          !/^(String|Int|Boolean|DateTime|Decimal|Json|BigInt|Bytes)$/.test(field.type) &&
          !blocks('enum').some((e) => e.name === field.type);
        if (isRelation || !/[A-Z]/.test(field.name)) continue;
        expect(field.line, `${model.name}.${field.name} needs @map("snake_case")`).toMatch(
          /@map\("[a-z0-9_]+"\)/,
        );
      }
    }
  });
});

describe('prisma/schema.prisma: money', () => {
  it('never uses Float', () => {
    for (const model of models) {
      for (const field of fields(model)) {
        expect(field.type, `${model.name}.${field.name}`).not.toBe('Float');
      }
    }
  });

  it('stores every Decimal as NUMERIC(12,2)', () => {
    const decimals = models.flatMap((model) =>
      fields(model)
        .filter((field) => field.type === 'Decimal')
        .map((field) => ({ ...field, model: model.name })),
    );
    expect(decimals.length).toBeGreaterThanOrEqual(12);
    for (const field of decimals) {
      expect(field.line, `${field.model}.${field.name}`).toMatch(/@db\.Decimal\(12,\s*2\)/);
    }
  });
});

describe('prisma/schema.prisma: tenant isolation', () => {
  it.each(TENANT_MODELS)('%s has business_id and UNIQUE (business_id, id)', (name) => {
    const model = modelNamed(name);
    expect(model, name).toBeDefined();
    expect(fields(model!).some((field) => field.name === 'businessId')).toBe(true);
    expect(model!.body).toMatch(/@@unique\(\[businessId,\s*id\]\)/);
  });

  it('links tenant tables only through composite (business_id, …) foreign keys', () => {
    let checked = 0;
    for (const model of models) {
      for (const field of fields(model)) {
        if (!TENANT_MODELS.includes(field.type)) continue;
        const relation = /@relation\(([^)]*)\)/.exec(field.line)?.[1] ?? '';
        const fieldList = /fields:\s*\[([^\]]*)\]/.exec(relation)?.[1];
        if (fieldList === undefined) continue; // the other side of the relation
        const references = /references:\s*\[([^\]]*)\]/.exec(relation)?.[1] ?? '';
        const where = `${model.name}.${field.name} -> ${field.type}`;
        expect(list(fieldList)[0], where).toBe('businessId');
        expect(list(fieldList), where).toHaveLength(2);
        expect(list(references), where).toEqual(['businessId', 'id']);
        checked++;
      }
    }
    // customer, address, order (×4), product, refundOf, codPayment
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  it('never cascades deletes', () => {
    expect(schema).not.toMatch(/onDelete:\s*Cascade/);
    expect(schema).not.toMatch(/onDelete:\s*SetNull/);
  });
});

describe('prisma/schema.prisma: trigram index (A23)', () => {
  it('names the operator class without its schema, so the drift check sees no false difference', () => {
    // Prisma reads the operator class from the database by its bare name (pg_opclass.opcname) and
    // compares it with this text exactly (prisma-engines: postgres/indexes_query.sql, schema_differ.rs).
    expect(schema).toMatch(
      /@@index\(\[name\(ops: raw\("gin_trgm_ops"\)\)\], type: Gin, map: "customers_name_trgm"\)/,
    );
    expect(schema).not.toContain('extensions.gin_trgm_ops');
  });
});
