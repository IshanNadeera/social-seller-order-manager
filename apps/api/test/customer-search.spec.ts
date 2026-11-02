// The customer search filter (src/customers/customer-search.ts), without a database.
// The database behaviour (ILIKE, endsWith on real rows) is covered in customers.db-spec.ts.
import { describe, expect, it } from 'vitest';
import { escapeLike } from '../src/common/like';
import { CUSTOMER_LIST_ORDER, customerSearchWhere } from '../src/customers/customer-search';

const scope = { businessId: '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6' };

describe('customerSearchWhere', () => {
  it('lists only active customers of the business when there is no search', () => {
    expect(customerSearchWhere(scope, undefined, false)).toEqual({
      AND: [{ archivedAt: null }],
      businessId: scope.businessId,
    });
  });

  it('includes archived customers only when asked', () => {
    expect(customerSearchWhere(scope, undefined, true)).toEqual({
      AND: [],
      businessId: scope.businessId,
    });
  });

  it('searches the name and the typed phone for any text', () => {
    expect(customerSearchWhere(scope, 'nim', false).AND).toEqual([
      { archivedAt: null },
      {
        OR: [
          { name: { contains: 'nim', mode: 'insensitive' } },
          { phoneDisplay: { contains: 'nim' } },
        ],
      },
    ]);
  });

  it.each(['0771234567', '+94 77 123 4567', '771234567', '0094-77-123-4567'])(
    'also matches the last 9 digits of the normalised phone for %s',
    (q) => {
      const where = customerSearchWhere(scope, q, false);
      expect(JSON.stringify(where)).toContain('{"phoneNormalized":{"endsWith":"771234567"}}');
    },
  );

  it('does not search by number with fewer than 9 digits', () => {
    expect(JSON.stringify(customerSearchWhere(scope, '4567', false))).not.toContain(
      'phoneNormalized',
    );
  });

  it('always applies the business last, so nothing in the search can change it', () => {
    const where = customerSearchWhere(scope, 'x', false);
    expect(Object.keys(where).at(-1)).toBe('businessId');
    expect(where.businessId).toBe(scope.businessId);
  });

  it('escapes LIKE wildcards so search text is matched literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(customerSearchWhere(scope, '_', false).AND).toContainEqual({
      OR: [
        { name: { contains: '\\_', mode: 'insensitive' } },
        { phoneDisplay: { contains: '\\_' } },
      ],
    });
  });

  it('pages in a stable order: name, then ID', () => {
    expect(CUSTOMER_LIST_ORDER).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });
});
