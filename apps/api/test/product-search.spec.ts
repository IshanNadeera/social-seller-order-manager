// The product search filter (src/products/product-search.ts), without a database.
// The database behaviour is covered in products.db-spec.ts.
import { describe, expect, it } from 'vitest';
import { PRODUCT_LIST_ORDER, productSearchWhere } from '../src/products/product-search';

const scope = { businessId: '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6' };

describe('productSearchWhere', () => {
  it('lists only active products of the business when there is no search', () => {
    expect(productSearchWhere(scope, undefined, false)).toEqual({
      AND: [{ archivedAt: null }],
      businessId: scope.businessId,
    });
  });

  it('includes archived products only when asked', () => {
    expect(productSearchWhere(scope, undefined, true)).toEqual({
      AND: [],
      businessId: scope.businessId,
    });
  });

  it('searches the name and the SKU, ignoring case, with wildcards escaped', () => {
    expect(productSearchWhere(scope, '50%_off', true).AND).toEqual([
      {
        OR: [
          { name: { contains: '50\\%\\_off', mode: 'insensitive' } },
          { sku: { contains: '50\\%\\_off', mode: 'insensitive' } },
        ],
      },
    ]);
  });

  it('always applies the business last, so nothing in the search can change it', () => {
    expect(Object.keys(productSearchWhere(scope, 'x', false)).at(-1)).toBe('businessId');
  });

  it('pages in a stable order: name, then ID', () => {
    expect(PRODUCT_LIST_ORDER).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });
});
