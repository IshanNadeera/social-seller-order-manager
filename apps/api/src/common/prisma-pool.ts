import type { Env } from './env';

/**
 * Largest number of database connections the API opens (docs/DEVELOPMENT.md §8.4, §10.4).
 * Kept small so the API stays within the Supabase plan's connection limits.
 */
export const PRISMA_POOL_MAX = 5;

/**
 * How long a request waits for a free or new connection before failing. node-postgres waits
 * forever by default, so without this a database outage would hang requests instead of failing them.
 */
export const PRISMA_CONNECTION_TIMEOUT_MS = 5_000;

/** Connection pool settings passed to the PrismaPg adapter (node-postgres pool options). */
export function prismaPoolConfig(env: Pick<Env, 'DATABASE_URL'>): {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
} {
  return {
    connectionString: env.DATABASE_URL,
    max: PRISMA_POOL_MAX,
    connectionTimeoutMillis: PRISMA_CONNECTION_TIMEOUT_MS,
  };
}
