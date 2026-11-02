// Idempotency-Key handling against the real database (docs/DEVELOPMENT.md §9.8, ADR-017, task C6),
// through a test-only route written the way POST /orders, payments and COD settle will use it.
// Run with: npm run test:db -w apps/api
import { randomUUID } from 'node:crypto';
import { Body, Controller, Post, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CurrentAuth } from '../src/auth/auth-context';
import type { AuthContext } from '../src/auth/auth-context';
import { JWKS } from '../src/auth/auth.module';
import { parseEnv } from '../src/common/env';
import { PrismaService } from '../src/common/prisma.service';
import { tenantData } from '../src/common/tenant';
import { ZodBodyPipe } from '../src/common/zod-body.pipe';
import { IdempotencyKey } from '../src/idempotency/idempotency-key.decorator';
import { IdempotencyModule } from '../src/idempotency/idempotency.module';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import { createTestAuth } from './test-auth';
import { createTwoTenants } from './tenant-isolation';
import type { Tenant, TwoTenants } from './tenant-isolation';

const thingSchema = z.strictObject({ name: z.string().min(1), fail: z.boolean().optional() });

/** Creates a customer (a real write) once per key. `fail: true` makes the work throw after the write. */
@Controller('test-idempotency/things')
class ThingsProbeController {
  constructor(private readonly idempotency: IdempotencyService) {}

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() key: string,
    @Body(new ZodBodyPipe(thingSchema)) input: z.output<typeof thingSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.execute(
      auth,
      { key, endpoint: 'POST /test-idempotency/things', payload: input },
      async (tx) => {
        const row = await tx.customer.create({
          data: tenantData(auth, { name: input.name }),
          select: { id: true, name: true, createdAt: true },
        });
        if (input.fail === true) throw new Error('work failed after writing');
        return row;
      },
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}

const PATH = '/api/v1/test-idempotency/things';
let app: NestExpressApplication;
let server: App;
let prisma: PrismaService;
let idempotency: IdempotencyService;
let tenants: TwoTenants;

beforeAll(async () => {
  const env = parseEnv(process.env);
  const auth = await createTestAuth(env.SUPABASE_JWT_ISSUER);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env), IdempotencyModule],
    controllers: [ThingsProbeController],
  })
    .overrideProvider(JWKS)
    .useValue(auth.jwks)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, env);
  await app.init();
  server = app.getHttpServer();
  prisma = moduleRef.get(PrismaService);
  idempotency = moduleRef.get(IdempotencyService);
  tenants = await createTwoTenants(prisma, auth);
});

afterAll(async () => {
  await tenants.cleanup();
  await app.close();
});

const post = (tenant: Tenant, body: object, key?: string) => {
  const req = request(server).post(PATH).set('Authorization', `Bearer ${tenant.token}`);
  return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
};
const customersNamed = (name: string) => prisma.customer.count({ where: { name } });

describe('Idempotency-Key header', () => {
  it('is required', async () => {
    const res = await post(tenants.a, { name: 'No Key Demo' }).expect(400);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(await customersNamed('No Key Demo')).toBe(0);
  });

  it('must be a UUID', async () => {
    const res = await post(tenants.a, { name: 'Bad Key Demo' }, 'not-a-uuid').expect(400);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID' });
  });
});

describe('same key', () => {
  it('same body: the stored response, and the work runs once', async () => {
    const key = randomUUID();
    const first = await post(tenants.a, { name: 'Once Demo' }, key).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    // Same JSON in another key order is the same request.
    const again = await post(tenants.a, { name: 'Once Demo' }, key.toUpperCase()).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await customersNamed('Once Demo')).toBe(1);
  });

  it('different body: 409 IDEMPOTENCY_KEY_REUSED, and nothing is created', async () => {
    const key = randomUUID();
    await post(tenants.a, { name: 'First Body Demo' }, key).expect(201);
    const res = await post(tenants.a, { name: 'Second Body Demo' }, key).expect(409);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await customersNamed('Second Body Demo')).toBe(0);
  });

  it('two attempts at the same moment: one creation, both get the same answer', async () => {
    const key = randomUUID();
    const [one, two] = await Promise.all([
      post(tenants.a, { name: 'Race Demo' }, key),
      post(tenants.a, { name: 'Race Demo' }, key),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body).toEqual(two.body);
    expect(await customersNamed('Race Demo')).toBe(1);
  });

  it('after a failure nothing is kept (the key included), so a retry runs fresh', async () => {
    const key = randomUUID();
    await post(tenants.a, { name: 'Fail Demo', fail: true }, key).expect(500);
    expect(await customersNamed('Fail Demo')).toBe(0);
    await post(tenants.a, { name: 'Fail Demo' }, key).expect(201);
    expect(await customersNamed('Fail Demo')).toBe(1);
  });

  it('belongs to one business: another business may use the same key', async () => {
    const key = randomUUID();
    await post(tenants.a, { name: 'Shared Key A' }, key).expect(201);
    const res = await post(tenants.b, { name: 'Shared Key B' }, key).expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toMatchObject({ name: 'Shared Key B' });
  });

  it('is refused on another endpoint', async () => {
    const key = randomUUID();
    await post(tenants.a, { name: 'Endpoint Demo' }, key).expect(201);
    await expect(
      idempotency.execute(
        { businessId: tenants.a.businessId, userId: tenants.a.userId },
        { key, endpoint: 'POST /orders', payload: { name: 'Endpoint Demo' } },
        () => Promise.resolve('never'),
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});

describe('clean-up', () => {
  it('deletes stored responses older than 48 hours only', async () => {
    const key = randomUUID();
    await post(tenants.a, { name: 'Expiry Demo' }, key).expect(201);
    const row = { businessId_key: { businessId: tenants.a.businessId, key } };
    const createdAt = (await prisma.idempotencyKey.findUniqueOrThrow({ where: row })).createdAt;

    await idempotency.deleteExpired(new Date(createdAt.getTime() + 47 * 3_600_000));
    expect(await prisma.idempotencyKey.findUnique({ where: row })).not.toBeNull();
    await idempotency.deleteExpired(new Date(createdAt.getTime() + 49 * 3_600_000));
    expect(await prisma.idempotencyKey.findUnique({ where: row })).toBeNull();
  });
});
