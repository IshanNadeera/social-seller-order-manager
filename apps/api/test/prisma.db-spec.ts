// Database test: needs a running Postgres (local Supabase: npm run db:start) and DATABASE_URL in
// apps/api/.env. Run with: npm run test:db -w apps/api. Not part of the default `npm test`.
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';

describe('PrismaService against the database', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(process.env))],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  it('runs a query through the PrismaPg adapter', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('connects to PostgreSQL', async () => {
    const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    expect(rows[0]?.version).toMatch(/^PostgreSQL /);
  });
});
