import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { IdParamPipe } from './id-param.pipe';
import { assertTouched, notFound, orNotFound, tenantData, tenantWhere } from './tenant';

const A = { businessId: '11111111-1111-4111-8111-111111111111' };
const B_ID = '22222222-2222-4222-8222-222222222222';

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error');
}

describe('tenantWhere / tenantData', () => {
  it('adds the business from the scope', () => {
    expect(tenantWhere(A, { id: 'x', archivedAt: null })).toEqual({
      id: 'x',
      archivedAt: null,
      businessId: A.businessId,
    });
    expect(tenantData(A, { name: 'Shop' })).toEqual({ name: 'Shop', businessId: A.businessId });
  });

  it('always wins over a businessId already in the object', () => {
    expect(tenantWhere(A, { id: 'x', businessId: B_ID }).businessId).toBe(A.businessId);
    expect(tenantData(A, { name: 'Shop', businessId: B_ID }).businessId).toBe(A.businessId);
  });
});

describe('the standard 404', () => {
  it('is the same response for every "not found"', () => {
    expect(notFound().getStatus()).toBe(404);
    expect(notFound().getResponse()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
  });

  it('orNotFound returns rows and turns null/undefined into the 404', () => {
    expect(orNotFound({ id: 'x' })).toEqual({ id: 'x' });
    expect(orNotFound(0)).toBe(0);
    for (const missing of [null, undefined]) {
      const error = errorOf(() => orNotFound(missing));
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual(notFound().getResponse());
    }
  });

  it('assertTouched treats zero updated rows as not found', () => {
    expect(() => assertTouched({ count: 1 })).not.toThrow();
    expect(errorOf(() => assertTouched({ count: 0 }))).toBeInstanceOf(NotFoundException);
  });
});

describe('IdParamPipe', () => {
  const pipe = new IdParamPipe();

  it('accepts a UUID (normalised to lower case)', () => {
    expect(pipe.transform(B_ID.toUpperCase())).toBe(B_ID);
  });

  it.each(['abc', '', '1', `${B_ID}x`, "' OR 1=1 --", 42, undefined])(
    'answers the standard 404 for %j',
    (value) => {
      const error = errorOf(() => pipe.transform(value));
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual(notFound().getResponse());
    },
  );
});
