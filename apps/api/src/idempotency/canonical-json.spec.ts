import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined properties', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('keeps array order, and writes null for undefined items', () => {
    expect(canonicalJson([2, 1, undefined])).toBe('[2,1,null]');
  });

  it('handles plain values', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(1.5)).toBe('1.5');
  });
});

describe('requestHash', () => {
  it('is the same for the same request in any key order', () => {
    expect(requestHash('POST /orders', { a: 1, b: '2' })).toBe(requestHash('POST /orders', { b: '2', a: 1 }));
  });

  it('differs for a different body or endpoint', () => {
    const base = requestHash('POST /orders', { a: 1 });
    expect(requestHash('POST /orders', { a: 2 })).not.toBe(base);
    expect(requestHash('POST /orders/x/payments', { a: 1 })).not.toBe(base);
  });
});
