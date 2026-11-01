import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { createQueryClient, shouldRetryQuery } from './query-client';

describe('createQueryClient', () => {
  it('never retries mutations automatically', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('retries queries with shouldRetryQuery', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });

  it('creates a separate cache each time', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});

describe('shouldRetryQuery', () => {
  it.each([
    ['offline', new ApiError(0, 'NETWORK_ERROR', 'x'), true],
    ['a timeout', new ApiError(0, 'TIMEOUT', 'x'), true],
    ['a server error', new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'), true],
    ['an unexpected error', new Error('x'), true],
    ['not signed in', new ApiError(401, 'UNAUTHORIZED', 'x'), false],
    ['not found', new ApiError(404, 'NOT_FOUND', 'x'), false],
    ['a validation error', new ApiError(400, 'VALIDATION_ERROR', 'x'), false],
  ])('retries once after %s', (_label, error, expected) => {
    expect(shouldRetryQuery(0, error)).toBe(expected);
    expect(shouldRetryQuery(1, error)).toBe(false);
  });
});
