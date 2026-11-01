// Seeds the local database with fake demo data (docs/DEVELOPMENT.md §13.2).
// Run with: npm run db:seed -w apps/api   (Prisma runs `tsx prisma/seed.ts`, see prisma.config.ts)
// This script creates its own PrismaClient because it runs outside the Nest app.
import '../src/load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseEnv } from '../src/common/env';
import { prismaPoolConfig } from '../src/common/prisma-pool';
import { PrismaClient } from '../src/generated/prisma/client';
import { assertSafeToSeed, seedDemoData } from './seed-demo';

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  assertSafeToSeed(env);
  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaPoolConfig(env)) });
  try {
    const summary = await seedDemoData(prisma);
    process.stdout.write(
      `Seeded demo business ${summary.businessId}: ${summary.customers} customers, ` +
        `${summary.addresses} addresses, ${summary.products} products.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
