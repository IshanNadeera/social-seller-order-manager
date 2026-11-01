import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Env } from './env';
import { ENV } from './env.module';
import { prismaPoolConfig } from './prisma-pool';

/**
 * The API's only database client (docs/DEVELOPMENT.md §8.4). Prisma 7 talks to Postgres through the
 * node-postgres driver adapter, using DATABASE_URL (the Supabase pooler) and a pool of at most 5.
 * Connections open lazily on the first query, so the API can start while the database is down;
 * the health check (A15) reports it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg(prismaPoolConfig(env)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
