// GET /api/v1/health (docs/DEVELOPMENT.md §9.1, §11.7) with a fake database: no auth needed,
// pings the database, and never reveals configuration or error details.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { HEALTH_DB_TIMEOUT_MS } from '../src/common/health/health.controller';
import { PrismaService } from '../src/common/prisma.service';
import { fakePrisma } from './fake-prisma';
import type { QueryOutcome } from './fake-prisma';
import { testEnv } from './test-env';

let app: NestExpressApplication | undefined;

async function healthWith(outcome: QueryOutcome) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(PrismaService)
    .useValue(fakePrisma(outcome))
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, testEnv);
  await app.init();
  return request(app.getHttpServer()).get('/api/v1/health');
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('answers 200 without a token when the database responds', async () => {
    const res = await healthWith('ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 when the database query fails, without any error details', async () => {
    const res = await healthWith('fail');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'unreachable' });
    expect(res.text).not.toMatch(/password|postgres|10\.0\.0\.5|5432/);
  });

  it(
    'answers 503 within the timeout when the database hangs',
    async () => {
      const started = Date.now();
      const res = await healthWith('hang');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', database: 'unreachable' });
      expect(Date.now() - started).toBeLessThan(HEALTH_DB_TIMEOUT_MS + 1_500);
    },
    HEALTH_DB_TIMEOUT_MS + 5_000,
  );

  it('reveals no configuration', async () => {
    const res = await healthWith('ok');
    expect(Object.keys(res.body as object).sort()).toEqual(['database', 'status']);
    for (const secretish of [
      testEnv.DATABASE_URL,
      testEnv.SUPABASE_URL,
      testEnv.NODE_ENV,
      'version',
    ]) {
      expect(res.text).not.toContain(secretish);
    }
  });
});
