import { describe, expect, it } from 'vitest';
import { productCreateSchema, productListQuerySchema, productUpdateSchema } from '../index.js';

const messages = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);

describe('productCreateSchema', () => {
  it('trims, keeps the SKU as typed, turns blanks into null and normalises the price', () => {
    expect(
      productCreateSchema.parse({
        name: ' Tea ',
        sku: ' ab-1 ',
        description: '',
        sellingPrice: '450',
      }),
    ).toEqual({ name: 'Tea', sku: 'ab-1', description: null, sellingPrice: '450.00' });
  });

  it('needs a name and a price', () => {
    expect(messages(productCreateSchema.safeParse({}))).toEqual([
      ['name', 'Enter the product name.'],
      ['sellingPrice', 'Enter the selling price.'],
    ]);
  });

  it('refuses unknown fields such as businessId', () => {
    const result = productCreateSchema.safeParse({
      name: 'Tea',
      sellingPrice: '1',
      businessId: 'x',
    });
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('productUpdateSchema', () => {
  it('accepts a single field, or null to clear the SKU', () => {
    expect(productUpdateSchema.parse({ sellingPrice: '2.5' })).toEqual({ sellingPrice: '2.50' });
    expect(productUpdateSchema.parse({ sku: null })).toEqual({ sku: null });
  });

  it('asks for at least one change, but reports an invalid field alone', () => {
    expect(messages(productUpdateSchema.safeParse({}))).toEqual([
      ['', 'Change at least one field.'],
    ]);
    expect(messages(productUpdateSchema.safeParse({ name: ' ' }))).toEqual([
      ['name', 'Enter the product name.'],
    ]);
  });
});

describe('productListQuerySchema', () => {
  it('fills in defaults and reads query-string values', () => {
    expect(productListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      includeArchived: false,
    });
    expect(productListQuerySchema.parse({ q: ' ab ', includeArchived: 'true' })).toEqual({
      q: 'ab',
      page: 1,
      pageSize: 25,
      includeArchived: true,
    });
  });
});
