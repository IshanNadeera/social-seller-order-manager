import { describe, expect, it } from 'vitest';
import {
  addressCreateSchema,
  addressUpdateSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
} from '../index.js';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);

describe('customerCreateSchema', () => {
  it('trims, lower-cases the email and turns blank optional text into null', () => {
    expect(
      customerCreateSchema.parse({
        name: ' Nimali ',
        phone: ' ',
        email: ' A@Example.TEST ',
        notes: '',
      }),
    ).toEqual({ name: 'Nimali', phone: null, email: 'a@example.test', notes: null });
  });

  it('needs a name and refuses unknown fields', () => {
    const result = customerCreateSchema.safeParse({ name: '  ', businessId: 'x' });
    expect(result.success).toBe(false);
    expect(issues(result)).toContainEqual(['name', 'Enter the customer’s name.']);
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });

  it('checks the optional first address', () => {
    const result = customerCreateSchema.safeParse({
      name: 'Kasun',
      address: { recipientName: 'Kasun', phone: '0712345678' },
    });
    expect(issues(result)).toEqual([['address.addressLine1', 'Enter the address.']]);
  });
});

describe('customerUpdateSchema', () => {
  it('keeps null to clear a field and leaves unsent fields out', () => {
    expect(customerUpdateSchema.parse({ phone: null })).toEqual({ phone: null });
  });

  it('reports an invalid field alone, not also as "no change"', () => {
    expect(issues(customerUpdateSchema.safeParse({ name: ' ' }))).toEqual([
      ['name', 'Enter the customer’s name.'],
    ]);
  });

  it('asks for at least one change', () => {
    expect(issues(customerUpdateSchema.safeParse({}))).toEqual([
      ['', 'Change at least one field.'],
    ]);
  });
});

describe('customerListQuerySchema', () => {
  it('fills in defaults', () => {
    expect(customerListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      includeArchived: false,
    });
  });

  it('reads query-string values and drops an empty search', () => {
    expect(
      customerListQuerySchema.parse({
        q: '  ',
        page: '3',
        pageSize: '100',
        includeArchived: 'true',
      }),
    ).toEqual({ q: undefined, page: 3, pageSize: 100, includeArchived: true });
  });

  it('caps the page size at 100', () => {
    expect(issues(customerListQuerySchema.safeParse({ pageSize: '101' }))).toEqual([
      ['pageSize', 'Use at most 100.'],
    ]);
  });
});

describe('addressCreateSchema', () => {
  const address = { recipientName: 'Kasun', phone: '0712345678', addressLine1: '12 Temple Road' };

  it('needs only the first line besides recipient and phone; the rest becomes null when blank', () => {
    expect(addressCreateSchema.parse({ ...address, city: ' ', postalCode: '' })).toMatchObject({
      ...address,
      city: null,
      postalCode: null,
    });
    expect(issues(addressCreateSchema.safeParse({ recipientName: 'Kasun', phone: '071' }))).toEqual(
      [['addressLine1', 'Enter the address.']],
    );
  });

  it('takes an optional isDefault and refuses unknown fields', () => {
    expect(addressCreateSchema.parse({ ...address, isDefault: true }).isDefault).toBe(true);
    const result = addressCreateSchema.safeParse({ ...address, customerId: 'x' });
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('addressUpdateSchema', () => {
  it('accepts a single field, null to clear, or isDefault: true', () => {
    expect(addressUpdateSchema.parse({ city: null })).toMatchObject({ city: null });
    expect(addressUpdateSchema.parse({ isDefault: true })).toMatchObject({ isDefault: true });
  });

  it('refuses isDefault: false, blank required fields and an empty change', () => {
    expect(issues(addressUpdateSchema.safeParse({ isDefault: false }))).toEqual([
      ['isDefault', 'To change the default, make another address the default.'],
    ]);
    expect(issues(addressUpdateSchema.safeParse({ addressLine1: '  ' }))).toEqual([
      ['addressLine1', 'Enter the address.'],
    ]);
    expect(issues(addressUpdateSchema.safeParse({}))).toEqual([['', 'Change at least one field.']]);
  });
});
