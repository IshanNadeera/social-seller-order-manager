// Proves the tenant-scoping pattern and the isolation helper end to end, using a test-only customers
// route written exactly as real endpoints must be (docs/DEVELOPMENT.md §11.1, §12.4).
// Needs a migrated local database. Run with: npm run test:db -w apps/api
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
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
import { IdParamPipe } from '../src/common/id-param.pipe';
import { PrismaService } from '../src/common/prisma.service';
import { assertTouched, orNotFound, tenantWhere } from '../src/common/tenant';
import { ZodBodyPipe } from '../src/common/zod-body.pipe';
import { createTestAuth } from './test-auth';
import { createTwoTenants, expectCrossTenant404, withoutRequestId } from './tenant-isolation';
import type { TwoTenants } from './tenant-isolation';

const renameSchema = z.strictObject({ name: z.string().trim().min(1) });

/** Test-only route following the tenant pattern: scope from @CurrentAuth(), IDs via IdParamPipe. */
@Controller('test-isolation/customers')
class CustomersProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', IdParamPipe) id: string) {
    return orNotFound(
      await this.prisma.customer.findFirst({
        where: tenantWhere(auth, { id }),
        select: { id: true, name: true },
      }),
    );
  }

  @Patch(':id')
  async rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParamPipe) id: string,
    @Body(new ZodBodyPipe(renameSchema)) input: z.output<typeof renameSchema>,
  ) {
    assertTouched(
      await this.prisma.customer.updateMany({ where: tenantWhere(auth, { id }), data: input }),
    );
    return { id, name: input.name };
  }
}

describe('tenant isolation (pattern + helper)', () => {
  let app: NestExpressApplication;
  let server: App;
  let prisma: PrismaService;
  let tenants: TwoTenants;
  let customerOfA: string;
  let customerOfB: string;

  const route = {
    get: { method: 'get' as const, path: (id: string) => `/api/v1/test-isolation/customers/${id}` },
    rename: {
      method: 'patch' as const,
      path: (id: string) => `/api/v1/test-isolation/customers/${id}`,
      body: { name: 'Taken over' },
    },
  };

  beforeAll(async () => {
    const env = parseEnv(process.env);
    const auth = await createTestAuth(env.SUPABASE_JWT_ISSUER);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [CustomersProbeController],
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

    tenants = await createTwoTenants(prisma, auth);
    customerOfA = (
      await prisma.customer.create({
        data: { businessId: tenants.a.businessId, name: 'Customer of A' },
      })
    ).id;
    customerOfB = (
      await prisma.customer.create({
        data: { businessId: tenants.b.businessId, name: 'Customer of B' },
      })
    ).id;
  });

  afterAll(async () => {
    await tenants.cleanup();
    await app.close();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('lets a business read its own record', async () => {
    await request(server)
      .get(route.get.path(customerOfA))
      .set(as(tenants.a.token))
      .expect(200, { id: customerOfA, name: 'Customer of A' });
  });

  it("answers A with the standard 404 for B's record, identical to a missing ID", async () => {
    await expectCrossTenant404(server, tenants.a, route.get, customerOfB);
    await expectCrossTenant404(server, tenants.b, route.get, customerOfA);
  });

  it("refuses to change B's record from A, and leaves it untouched", async () => {
    await expectCrossTenant404(server, tenants.a, route.rename, customerOfB);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customerOfB } });
    expect(row.name).toBe('Customer of B');
  });

  it('answers the same 404 for an ID that is not a UUID', async () => {
    const res = await request(server).get(route.get.path('not-a-uuid')).set(as(tenants.a.token));
    expect(res.status).toBe(404);
    expect(withoutRequestId(res.body)).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found.',
      fieldErrors: {},
    });
  });

  it('ignores a businessId in the query string', async () => {
    await request(server)
      .get(`${route.get.path(customerOfB)}?businessId=${tenants.b.businessId}`)
      .set(as(tenants.a.token))
      .expect(404);
  });

  it('rejects a businessId in the body (strict schemas)', async () => {
    const res = await request(server)
      .patch(route.rename.path(customerOfB))
      .set(as(tenants.a.token))
      .send({ name: 'x', businessId: tenants.b.businessId });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ fieldErrors: { businessId: 'This field is not allowed.' } });
  });

  it('cleanup removes both businesses and their data', async () => {
    const extra = await createTwoTenants(
      prisma,
      await createTestAuth('http://issuer.test/auth/v1'),
    );
    await prisma.customer.create({ data: { businessId: extra.a.businessId, name: 'Temp' } });
    await extra.cleanup();
    const ids = [extra.a.businessId, extra.b.businessId];
    expect(await prisma.business.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.customer.count({ where: { businessId: { in: ids } } })).toBe(0);
  });
});
