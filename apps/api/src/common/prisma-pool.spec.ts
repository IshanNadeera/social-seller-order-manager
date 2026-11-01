import { describe, expect, it } from 'vitest';
import { PRISMA_POOL_MAX, prismaPoolConfig } from './prisma-pool';

describe('prismaPoolConfig', () => {
  it('uses DATABASE_URL, caps the pool at 5 connections and never waits forever', () => {
    const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    expect(prismaPoolConfig({ DATABASE_URL })).toEqual({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
    expect(PRISMA_POOL_MAX).toBe(5);
  });
});
