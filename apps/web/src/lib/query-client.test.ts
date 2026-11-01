import { describe, expect, it } from 'vitest';
import { createQueryClient } from './query-client';

describe('createQueryClient', () => {
  it('never retries mutations automatically', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('retries a failed query once', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(1);
  });

  it('creates a separate cache each time', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
