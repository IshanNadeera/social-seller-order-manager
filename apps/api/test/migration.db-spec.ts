// Checks the migrated database (docs/DEVELOPMENT.md §8.3, §8.5, §11.3, ADR-004): RLS and grants,
// indexes, and that every hand-written constraint rejects bad data.
// Needs a migrated database: npm run db:start && npm run db:migrate -w apps/api
// Run with: npm run test:db -w apps/api
//
// Each data test runs in a transaction that is always rolled back, so nothing is left behind.
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { Prisma } from '../src/generated/prisma/client';

type Tx = Prisma.TransactionClient;
const sql = Prisma.sql;

const TABLES = [
  'business_counters',
  'business_members',
  'businesses',
  'customer_addresses',
  'customers',
  'deliveries',
  'idempotency_keys',
  'order_events',
  'order_items',
  'orders',
  'payments',
  'products',
  'users',
];

let prisma: PrismaService;
let close: () => Promise<void>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(parseEnv(process.env))],
  }).compile();
  prisma = moduleRef.get(PrismaService);
  close = () => moduleRef.close();
});

afterAll(async () => {
  await close();
});

// ---------- Fixture: one business with an owner, a customer, a product and a valid order ----------

interface Fixture {
  userId: string;
  businessId: string;
  customerId: string;
  productId: string;
  orderId: string;
}

let counter = 0;
const unique = () => `${Date.now()}-${process.pid}-${++counter}`;

async function insertId(tx: Tx, query: Prisma.Sql): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>(query);
  const id = rows[0]?.id;
  if (!id) throw new Error('Insert returned no id');
  return id;
}

async function createBusiness(tx: Tx, userId: string): Promise<string> {
  const businessId = await insertId(
    tx,
    sql`INSERT INTO app.businesses (name, updated_at) VALUES ('Test business', now()) RETURNING id`,
  );
  await tx.$executeRaw`INSERT INTO app.business_counters (business_id) VALUES (${businessId}::uuid)`;
  await tx.$executeRaw`INSERT INTO app.business_members (business_id, user_id, role)
    VALUES (${businessId}::uuid, ${userId}::uuid, 'OWNER')`;
  return businessId;
}

async function createFixture(tx: Tx): Promise<Fixture> {
  const userId = await insertId(
    tx,
    sql`INSERT INTO app.users (id, email, updated_at)
        VALUES (gen_random_uuid(), ${`owner-${unique()}@example.test`}, now()) RETURNING id`,
  );
  const businessId = await createBusiness(tx, userId);
  const customerId = await insertId(
    tx,
    sql`INSERT INTO app.customers (business_id, name, updated_at)
        VALUES (${businessId}::uuid, 'Test customer', now()) RETURNING id`,
  );
  const productId = await insertId(
    tx,
    sql`INSERT INTO app.products (business_id, name, sku, selling_price, updated_at)
        VALUES (${businessId}::uuid, 'Test product', ${`SKU-${unique()}`}, 1500.00, now()) RETURNING id`,
  );
  const orderId = await insertOrder(tx, { businessId, customerId, userId });
  return { userId, businessId, customerId, productId, orderId };
}

interface OrderValues {
  businessId: string;
  customerId: string | null;
  userId: string;
  sourceChannel?: string;
  sourceNote?: string | null;
  fulfilmentType?: string;
  paymentMethod?: string;
  subtotal?: string;
  discount?: string;
  deliveryFee?: string;
  total?: string;
  paid?: string;
  refunded?: string;
}

/** Inserts an order; defaults make a valid order (3000 − 100 + 350 = 3250). */
function insertOrder(tx: Tx, v: OrderValues): Promise<string> {
  return insertId(
    tx,
    sql`INSERT INTO app.orders (
          business_id, order_number, customer_id, source_channel, source_note, fulfilment_type,
          payment_method, currency, subtotal, discount_amount, delivery_fee, total_amount,
          amount_paid, amount_refunded, customer_name_snapshot, created_by, updated_at)
        VALUES (
          ${v.businessId}::uuid, ${`T-${unique()}`}, ${v.customerId}::uuid,
          ${v.sourceChannel ?? 'WHATSAPP'}::app.source_channel, ${v.sourceNote ?? null},
          ${v.fulfilmentType ?? 'DELIVERY'}::app.fulfilment_type,
          ${v.paymentMethod ?? 'CASH'}::app.payment_method, 'LKR',
          ${v.subtotal ?? '3000.00'}::numeric, ${v.discount ?? '100.00'}::numeric,
          ${v.deliveryFee ?? '350.00'}::numeric, ${v.total ?? '3250.00'}::numeric,
          ${v.paid ?? '0'}::numeric, ${v.refunded ?? '0'}::numeric,
          'Test customer', ${v.userId}::uuid, now())
        RETURNING id`,
  );
}

class Rollback extends Error {}

/**
 * Runs `body` after creating the fixture, inside a transaction that is always rolled back.
 * Resolves to undefined if `body` succeeded, or to the database error it raised.
 */
async function attempt(body: (tx: Tx, f: Fixture) => Promise<unknown>): Promise<unknown> {
  try {
    await prisma.$transaction(async (tx) => {
      const fixture = await createFixture(tx);
      await body(tx, fixture);
      throw new Rollback();
    });
  } catch (error) {
    return error instanceof Rollback ? undefined : error;
  }
  throw new Error('The test transaction was not rolled back');
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return JSON.stringify(error);
  const { meta, cause } = error as { meta?: unknown; cause?: unknown };
  const causeText = cause instanceof Error ? cause.message : JSON.stringify(cause ?? null);
  return `${error.message} ${JSON.stringify(meta ?? {})} ${causeText}`;
}

async function expectRejected(name: string, body: (tx: Tx, f: Fixture) => Promise<unknown>) {
  const error = await attempt(body);
  expect(error, `expected ${name} to reject the row`).toBeDefined();
  expect(describeError(error)).toContain(name);
}

// ---------- Schema, grants and RLS ----------

describe('app schema', () => {
  it('contains exactly the expected tables', async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual(TABLES);
  });

  it('has row-level security enabled on every table', async () => {
    const rows = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it.each(['anon', 'authenticated', 'service_role'])(
    'gives the %s role no access to the app schema or its tables',
    async (role) => {
      const [exists] = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
      if (!exists?.exists) return; // plain Postgres without Supabase roles
      const [schema] = await prisma.$queryRaw<{ usage: boolean }[]>`
        SELECT has_schema_privilege(${role}, 'app', 'USAGE') AS usage`;
      expect(schema?.usage).toBe(false);
      const granted = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'app' AND grantee = ${role}`;
      expect(granted).toEqual([]);
    },
  );

  it('has the partial unique indexes and the trigram search index', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app'`;
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get('business_one_owner')).toMatch(/UNIQUE.*WHERE \(role = 'OWNER'/);
    expect(byName.get('products_sku_unique')).toMatch(
      /UNIQUE.*WHERE \(\(sku IS NOT NULL\) AND \(archived_at IS NULL\)\)/,
    );
    expect(byName.get('address_one_default')).toMatch(
      /UNIQUE.*WHERE \(is_default AND \(archived_at IS NULL\)\)/,
    );
    // pg_indexes prints the operator class without its schema when that schema is on the search
    // path (it is on Supabase), so check the access method here and the schema in the catalog below.
    expect(byName.get('customers_name_trgm')).toMatch(
      /USING gin \(name (extensions\.)?gin_trgm_ops\)/,
    );
  });

  it('keeps pg_trgm and the trigram operator class in the extensions schema', async () => {
    const [extension] = await prisma.$queryRaw<{ schema: string }[]>`
      SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_trgm'`;
    expect(extension?.schema).toBe('extensions');

    const [opclass] = await prisma.$queryRaw<{ schema: string; name: string }[]>`
      SELECT n.nspname AS schema, opc.opcname AS name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_opclass opc ON opc.oid = i.indclass[0]
      JOIN pg_namespace n ON n.oid = opc.opcnamespace
      WHERE c.relname = 'customers_name_trgm'`;
    expect(opclass).toEqual({ schema: 'extensions', name: 'gin_trgm_ops' });
  });
});

// ---------- Constraints ----------

describe('a valid fixture', () => {
  it('is accepted (control for the rejection tests below)', async () => {
    expect(await attempt(() => Promise.resolve())).toBeUndefined();
  });
});

describe('CHECK constraints reject bad rows', () => {
  it.each([
    ['businesses_prefix_chk', 'ab'],
    ['businesses_prefix_chk', 'A'],
    ['businesses_prefix_chk', 'NI-M'],
  ])('%s rejects order prefix %j', async (name, prefix) => {
    await expectRejected(
      name,
      (tx, f) =>
        tx.$executeRaw`UPDATE app.businesses SET order_prefix = ${prefix} WHERE id = ${f.businessId}::uuid`,
    );
  });

  it('businesses_fee_chk rejects a negative default delivery fee', async () => {
    await expectRejected(
      'businesses_fee_chk',
      (tx, f) =>
        tx.$executeRaw`UPDATE app.businesses SET default_delivery_fee = -1 WHERE id = ${f.businessId}::uuid`,
    );
  });

  it('counters_seq_chk rejects a sequence below 1', async () => {
    await expectRejected(
      'counters_seq_chk',
      (tx, f) =>
        tx.$executeRaw`UPDATE app.business_counters SET next_order_seq = 0 WHERE business_id = ${f.businessId}::uuid`,
    );
  });

  it('users_email_lower_chk rejects an email with capitals', async () => {
    await expectRejected(
      'users_email_lower_chk',
      (tx, f) =>
        tx.$executeRaw`UPDATE app.users SET email = ${`Owner-${unique()}@Example.test`} WHERE id = ${f.userId}::uuid`,
    );
  });

  it('products_price_chk rejects a negative price', async () => {
    await expectRejected(
      'products_price_chk',
      (tx, f) =>
        tx.$executeRaw`UPDATE app.products SET selling_price = -0.01 WHERE id = ${f.productId}::uuid`,
    );
  });

  describe('order items', () => {
    const insertItem = (
      tx: Tx,
      f: Fixture,
      quantity: number,
      unitPrice: string,
      lineTotal: string,
    ) =>
      tx.$executeRaw`INSERT INTO app.order_items
          (business_id, order_id, product_id, position, product_name_snapshot, quantity, unit_price, line_total)
        VALUES (${f.businessId}::uuid, ${f.orderId}::uuid, ${f.productId}::uuid, 0, 'Test product',
          ${quantity}, ${unitPrice}::numeric, ${lineTotal}::numeric)`;

    it('accepts a correct line', async () => {
      expect(await attempt((tx, f) => insertItem(tx, f, 2, '1500.00', '3000.00'))).toBeUndefined();
    });

    it.each([0, 10000])('items_qty_chk rejects quantity %s', async (quantity) => {
      await expectRejected('items_qty_chk', (tx, f) =>
        insertItem(tx, f, quantity, '1.00', `${quantity}.00`),
      );
    });

    it('items_price_chk rejects a negative unit price', async () => {
      await expectRejected('items_price_chk', (tx, f) => insertItem(tx, f, 1, '-1.00', '-1.00'));
    });

    it('items_line_total_chk rejects a line total that is not quantity × unit price', async () => {
      await expectRejected('items_line_total_chk', (tx, f) =>
        insertItem(tx, f, 2, '1500.00', '2999.99'),
      );
    });
  });

  describe('orders', () => {
    it('orders_discount_chk rejects a discount above the subtotal', async () => {
      await expectRejected('orders_discount_chk', (tx, f) =>
        insertOrder(tx, {
          ...f,
          subtotal: '100.00',
          discount: '150.00',
          deliveryFee: '50.00',
          total: '0.00',
        }),
      );
    });

    it('orders_amounts_chk rejects a negative delivery fee', async () => {
      await expectRejected('orders_amounts_chk', (tx, f) =>
        insertOrder(tx, { ...f, deliveryFee: '-10.00', total: '2890.00' }),
      );
    });

    it('orders_total_chk rejects a total that does not add up', async () => {
      await expectRejected('orders_total_chk', (tx, f) =>
        insertOrder(tx, { ...f, total: '3251.00' }),
      );
    });

    it('orders_paid_chk rejects refunds above payments', async () => {
      await expectRejected('orders_paid_chk', (tx, f) =>
        insertOrder(tx, { ...f, paid: '100.00', refunded: '100.01' }),
      );
    });

    it('orders_customer_chk rejects a missing customer unless the order is a walk-in', async () => {
      await expectRejected('orders_customer_chk', (tx, f) =>
        insertOrder(tx, {
          ...f,
          customerId: null,
          sourceChannel: 'PHONE',
          fulfilmentType: 'PICKUP',
        }),
      );
    });

    it('accepts an anonymous walk-in pickup', async () => {
      expect(
        await attempt((tx, f) =>
          insertOrder(tx, {
            ...f,
            customerId: null,
            sourceChannel: 'WALK_IN',
            fulfilmentType: 'PICKUP',
            deliveryFee: '0.00',
            total: '2900.00',
          }),
        ),
      ).toBeUndefined();
    });

    it('orders_walk_in_chk rejects an anonymous walk-in delivery', async () => {
      await expectRejected('orders_walk_in_chk', (tx, f) =>
        insertOrder(tx, {
          ...f,
          customerId: null,
          sourceChannel: 'WALK_IN',
          fulfilmentType: 'DELIVERY',
        }),
      );
    });

    it('orders_cod_delivery_chk rejects COD on a pickup order', async () => {
      await expectRejected('orders_cod_delivery_chk', (tx, f) =>
        insertOrder(tx, { ...f, paymentMethod: 'COD', fulfilmentType: 'PICKUP' }),
      );
    });

    it('orders_other_note_chk requires a note when the source is OTHER', async () => {
      await expectRejected('orders_other_note_chk', (tx, f) =>
        insertOrder(tx, { ...f, sourceChannel: 'OTHER', sourceNote: null }),
      );
    });

    it('orders_note_len_chk rejects a source note over 100 characters', async () => {
      await expectRejected('orders_note_len_chk', (tx, f) =>
        insertOrder(tx, { ...f, sourceChannel: 'OTHER', sourceNote: 'x'.repeat(101) }),
      );
    });
  });

  describe('payments', () => {
    const insertPayment = (
      tx: Tx,
      f: Fixture,
      type: string,
      amount: string,
      refundOf: string | null,
    ) =>
      insertId(
        tx,
        sql`INSERT INTO app.payments (business_id, order_id, type, method, amount, refund_of_payment_id, recorded_by, occurred_at)
            VALUES (${f.businessId}::uuid, ${f.orderId}::uuid, ${type}::app.payment_type, 'CASH',
              ${amount}::numeric, ${refundOf}::uuid, ${f.userId}::uuid, now())
            RETURNING id`,
      );

    it.each(['0.00', '-5.00'])('payments_amount_chk rejects amount %s', async (amount) => {
      await expectRejected('payments_amount_chk', (tx, f) =>
        insertPayment(tx, f, 'PAYMENT', amount, null),
      );
    });

    it('payments_refund_of_chk allows refund_of only on refunds', async () => {
      await expectRejected('payments_refund_of_chk', async (tx, f) => {
        const paymentId = await insertPayment(tx, f, 'PAYMENT', '100.00', null);
        await insertPayment(tx, f, 'PAYMENT', '50.00', paymentId);
      });
      expect(
        await attempt(async (tx, f) => {
          const paymentId = await insertPayment(tx, f, 'PAYMENT', '100.00', null);
          await insertPayment(tx, f, 'REFUND', '50.00', paymentId);
        }),
      ).toBeUndefined();
    });
  });

  describe('deliveries', () => {
    const insertDelivery = (tx: Tx, f: Fixture, codAmount: string, attempts: number) =>
      tx.$executeRaw`INSERT INTO app.deliveries
          (business_id, order_id, recipient_name, phone, address_line_1, cod_amount, attempt_count, updated_at)
        VALUES (${f.businessId}::uuid, ${f.orderId}::uuid, 'Test recipient', '+94770000000', '1 Test Road',
          ${codAmount}::numeric, ${attempts}, now())`;

    it('deliveries_cod_chk rejects a negative COD amount', async () => {
      await expectRejected('deliveries_cod_chk', (tx, f) => insertDelivery(tx, f, '-1.00', 0));
    });

    it('deliveries_attempts_chk rejects a negative attempt count', async () => {
      await expectRejected('deliveries_attempts_chk', (tx, f) => insertDelivery(tx, f, '0.00', -1));
    });
  });
});

describe('partial unique indexes', () => {
  it('business_one_owner allows only one OWNER per business', async () => {
    await expectRejected('business_one_owner', async (tx, f) => {
      const otherUser = await insertId(
        tx,
        sql`INSERT INTO app.users (id, email, updated_at)
            VALUES (gen_random_uuid(), ${`second-${unique()}@example.test`}, now()) RETURNING id`,
      );
      await tx.$executeRaw`INSERT INTO app.business_members (business_id, user_id, role)
        VALUES (${f.businessId}::uuid, ${otherUser}::uuid, 'OWNER')`;
    });
  });

  it('products_sku_unique rejects a duplicate active SKU but allows reusing an archived one', async () => {
    const duplicate = (archiveFirst: boolean) => async (tx: Tx, f: Fixture) => {
      if (archiveFirst) {
        await tx.$executeRaw`UPDATE app.products SET archived_at = now() WHERE id = ${f.productId}::uuid`;
      }
      await tx.$executeRaw`INSERT INTO app.products (business_id, name, sku, selling_price, updated_at)
        SELECT business_id, 'Copy', sku, 1.00, now() FROM app.products WHERE id = ${f.productId}::uuid`;
    };
    await expectRejected('products_sku_unique', duplicate(false));
    expect(await attempt(duplicate(true))).toBeUndefined();
  });

  it('address_one_default allows only one active default address per customer', async () => {
    const insertDefault = (tx: Tx, f: Fixture) =>
      tx.$executeRaw`INSERT INTO app.customer_addresses
          (business_id, customer_id, recipient_name, phone, address_line_1, is_default, updated_at)
        VALUES (${f.businessId}::uuid, ${f.customerId}::uuid, 'Test', '0770000000', '1 Test Road', true, now())`;
    await expectRejected('address_one_default', async (tx, f) => {
      await insertDefault(tx, f);
      await insertDefault(tx, f);
    });
  });
});

describe('composite foreign keys keep businesses apart (§8.1, §11.1)', () => {
  /** A second business with its own customer, created inside the same rolled-back transaction. */
  async function otherBusiness(tx: Tx, f: Fixture) {
    const businessId = await createBusiness(
      tx,
      await insertId(
        tx,
        sql`INSERT INTO app.users (id, email, updated_at)
            VALUES (gen_random_uuid(), ${`other-${unique()}@example.test`}, now()) RETURNING id`,
      ),
    );
    const customerId = await insertId(
      tx,
      sql`INSERT INTO app.customers (business_id, name, updated_at)
          VALUES (${businessId}::uuid, 'Other customer', now()) RETURNING id`,
    );
    return { businessId, customerId, userId: f.userId };
  }

  it("rejects an order that points at another business's customer", async () => {
    await expectRejected('orders_business_id_customer_id_fkey', async (tx, f) => {
      const other = await otherBusiness(tx, f);
      await insertOrder(tx, {
        businessId: f.businessId,
        customerId: other.customerId,
        userId: f.userId,
      });
    });
  });

  it("rejects an order item that points at another business's order", async () => {
    await expectRejected('order_items_business_id_order_id_fkey', async (tx, f) => {
      const other = await otherBusiness(tx, f);
      await tx.$executeRaw`INSERT INTO app.order_items
          (business_id, order_id, position, product_name_snapshot, quantity, unit_price, line_total)
        VALUES (${other.businessId}::uuid, ${f.orderId}::uuid, 0, 'X', 1, 1.00, 1.00)`;
    });
  });
});
