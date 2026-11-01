// Unit tests for the demo seed (docs/DEVELOPMENT.md §13.2): the data is visibly fake and satisfies
// the database's own rules, and the safety guard refuses production and remote databases.
import { describe, expect, it } from 'vitest';
import { DEMO_BUSINESS, DEMO_CUSTOMERS, DEMO_OWNER, DEMO_PRODUCTS } from '../prisma/demo-data';
import { assertSafeToSeed } from '../prisma/seed-demo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MONEY = /^\d{1,10}\.\d{2}$/; // NUMERIC(12,2): at most 99,999,999.99

const addresses = DEMO_CUSTOMERS.flatMap((customer) => customer.addresses);
const emails = [DEMO_OWNER.email, ...DEMO_CUSTOMERS.map((c) => c.email)].filter(
  (email): email is string => email !== null,
);
const phones = [
  DEMO_BUSINESS.contactPhone,
  ...DEMO_CUSTOMERS.map((c) => c.phoneDisplay),
  ...addresses.map((a) => a.phone),
].filter((phone): phone is string => phone !== null);

describe('demo data contains no real personal data', () => {
  it('uses the surname "Demo" for every person', () => {
    expect(DEMO_OWNER.fullName).toMatch(/\bDemo\b/);
    for (const customer of DEMO_CUSTOMERS) expect(customer.name).toMatch(/\bDemo\b/);
    for (const a of addresses) expect(a.recipientName).toMatch(/\bDemo\b/);
  });

  it('uses only the reserved example.test email domain', () => {
    for (const email of emails) expect(email).toMatch(/@example\.test$/);
  });

  it('uses only placeholder 07x 000 00xx phone numbers', () => {
    for (const phone of phones) {
      const digits = phone.replace(/\D/g, '').replace(/^94/, '0');
      expect(digits, phone).toMatch(/^07\d0000\d{3}$/);
    }
  });

  it('uses only Demo Lane street addresses', () => {
    for (const a of addresses) expect(a.addressLine1).toMatch(/^\d+ Demo Lane$/);
  });

  it('labels every product as a demo', () => {
    for (const p of DEMO_PRODUCTS) expect(p.name).toMatch(/\(demo\)$/);
  });
});

describe('demo data satisfies the database rules', () => {
  it('uses unique version-4 UUIDs', () => {
    const ids = [
      DEMO_OWNER.id,
      DEMO_BUSINESS.id,
      ...DEMO_CUSTOMERS.map((c) => c.id),
      ...addresses.map((a) => a.id),
      ...DEMO_PRODUCTS.map((p) => p.id),
    ];
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a valid order prefix and money amounts (businesses_prefix_chk, NUMERIC(12,2))', () => {
    expect(DEMO_BUSINESS.orderPrefix).toMatch(/^[A-Z0-9]{2,6}$/);
    expect(DEMO_BUSINESS.defaultDeliveryFee).toMatch(MONEY);
    for (const p of DEMO_PRODUCTS) expect(p.sellingPrice, p.name).toMatch(MONEY);
  });

  it('stores emails in lower case (users_email_lower_chk)', () => {
    for (const email of emails) expect(email).toBe(email.toLowerCase());
  });

  it('stores normalized phones as E.164 matching the typed number (§7.11)', () => {
    for (const c of DEMO_CUSTOMERS) {
      if (c.phoneDisplay === null) {
        expect(c.phoneNormalized).toBeNull();
        continue;
      }
      expect(c.phoneNormalized).toMatch(/^\+94\d{9}$/);
      expect(c.phoneNormalized?.slice(-9)).toBe(c.phoneDisplay.replace(/\D/g, '').slice(-9));
    }
  });

  it('gives each customer at most one default address (address_one_default)', () => {
    for (const c of DEMO_CUSTOMERS) {
      expect(c.addresses.filter((a) => a.isDefault).length, c.name).toBeLessThanOrEqual(1);
    }
  });

  it('keeps SKUs unique among active products (products_sku_unique)', () => {
    const skus = DEMO_PRODUCTS.filter((p) => !p.archived && p.sku !== null).map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('covers the cases the UI needs: no phone, several addresses, no SKU, archived', () => {
    expect(DEMO_CUSTOMERS.some((c) => c.phoneDisplay === null)).toBe(true);
    expect(DEMO_CUSTOMERS.some((c) => c.addresses.length > 1)).toBe(true);
    expect(DEMO_CUSTOMERS.some((c) => c.addresses.length === 0)).toBe(true);
    expect(DEMO_PRODUCTS.some((p) => p.sku === null)).toBe(true);
    expect(DEMO_PRODUCTS.some((p) => p.archived)).toBe(true);
  });
});

describe('assertSafeToSeed', () => {
  const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const remote = 'postgresql://app:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://postgres:postgres@localhost:54322/postgres',
    'postgresql://postgres:postgres@[::1]:54322/postgres',
  ])('allows a local database (%s)', (DATABASE_URL) => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'development', DATABASE_URL }, false)).not.toThrow();
  });

  it('refuses production, even on a local database', () => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'production', DATABASE_URL: local }, true)).toThrow(
      /production/,
    );
  });

  it('refuses a remote database by default', () => {
    expect(() =>
      assertSafeToSeed({ NODE_ENV: 'development', DATABASE_URL: remote }, false),
    ).toThrow(/SEED_ALLOW_REMOTE/);
  });

  it('allows a remote (staging) database only when explicitly allowed', () => {
    expect(() =>
      assertSafeToSeed({ NODE_ENV: 'development', DATABASE_URL: remote }, true),
    ).not.toThrow();
  });

  it('never prints the connection string', () => {
    try {
      assertSafeToSeed({ NODE_ENV: 'development', DATABASE_URL: remote }, false);
    } catch (error) {
      expect(String(error)).not.toContain('pw@');
    }
  });
});
