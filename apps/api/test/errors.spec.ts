// A18 (docs/DEVELOPMENT.md §9.7, §9.8, §11.7): every error leaves the API as
// { code, message, fieldErrors, requestId }, unknown fields are refused, every response carries
// X-Request-Id, and the JSON request log holds no tokens, query strings or personal data.
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Public } from '../src/auth/public.decorator';
import { notFound } from '../src/common/tenant';
import { ZodBodyPipe, ZodQueryPipe } from '../src/common/zod-body.pipe';
import { TEST_BUSINESS_ID, startHttpTestApp } from './http-app';
import type { HttpTestApp } from './http-app';

const USER_ID = '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b';
const EMAIL = 'seller.one@example.com';
const PHONE = '0771234567';
const KB = 1024;

const createSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name.'),
  items: z.array(z.strictObject({ quantity: z.number().int().min(1, 'Must be at least 1') })),
});
const listSchema = z.strictObject({
  page: z.coerce.number().int().min(1, 'Must be 1 or more').default(1),
  q: z.string().optional(),
});

/** Test-only routes that raise each kind of error. */
@Controller('test-errors')
class ProbeController {
  @Post('create')
  @HttpCode(200)
  create(@Body(new ZodBodyPipe(createSchema)) input: z.output<typeof createSchema>): {
    ok: boolean;
    name: string;
  } {
    return { ok: true, name: input.name };
  }

  @Get('list')
  list(@Query(new ZodQueryPipe(listSchema)) query: z.output<typeof listSchema>): { page: number } {
    return { page: query.page };
  }

  @Get('missing')
  missing(): never {
    throw notFound();
  }

  @Get('boom')
  boom(): never {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
  }

  @Public()
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: unknown): { received: string } {
    return { received: typeof body };
  }
}

let ctx: HttpTestApp;
let app: NestExpressApplication;
let server: App;
let token: string;

beforeAll(async () => {
  ctx = await startHttpTestApp([ProbeController]);
  app = ctx.app;
  server = app.getHttpServer();
  token = await ctx.auth.sign(USER_ID, EMAIL);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  ctx.logLines.length = 0;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Checks the §9.7 shape and that the body's requestId matches the X-Request-Id header. */
function expectErrorShape(res: Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body as object).sort()).toEqual([
    'code',
    'fieldErrors',
    'message',
    'requestId',
  ]);
  const body = res.body as { code: string; message: string; requestId: string };
  expect(body.code).toBe(code);
  expect(body.message.length).toBeGreaterThan(0);
  expect(body.requestId).toBe(res.headers['x-request-id']);
  expect(res.headers['cache-control']).toBe('no-store');
}

describe('error shape (§9.7)', () => {
  it('400 VALIDATION_ERROR with a message per field', async () => {
    const res = await request(server)
      .post('/api/v1/test-errors/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  ', items: [{ quantity: 0 }] });
    expectErrorShape(res, 400, 'VALIDATION_ERROR');
    expect(res.body).toMatchObject({
      fieldErrors: { name: 'Enter a name.', 'items[0].quantity': 'Must be at least 1' },
    });
  });

  it('refuses unknown fields instead of dropping them (forbidNonWhitelisted)', async () => {
    const res = await request(server)
      .post('/api/v1/test-errors/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nimali', items: [], businessId: TEST_BUSINESS_ID, items2: 1 });
    expectErrorShape(res, 400, 'VALIDATION_ERROR');
    expect(res.body).toMatchObject({
      fieldErrors: {
        businessId: 'This field is not allowed.',
        items2: 'This field is not allowed.',
      },
    });
  });

  it('accepts a valid body and returns the parsed (trimmed) value', async () => {
    await request(server)
      .post('/api/v1/test-errors/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  Nimali ', items: [{ quantity: 2 }] })
      .expect(200, { ok: true, name: 'Nimali' });
  });

  it('validates query parameters the same way', async () => {
    const bad = await request(server)
      .get('/api/v1/test-errors/list?page=0&businessId=x')
      .set('Authorization', `Bearer ${token}`);
    expectErrorShape(bad, 400, 'VALIDATION_ERROR');
    expect(bad.body).toMatchObject({
      fieldErrors: { page: 'Must be 1 or more', businessId: 'This field is not allowed.' },
    });
    await request(server)
      .get('/api/v1/test-errors/list?page=3')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { page: 3 });
  });

  it('401 UNAUTHORIZED without a token', async () => {
    const res = await request(server).get('/api/v1/test-errors/missing');
    expectErrorShape(res, 401, 'UNAUTHORIZED');
  });

  it('404 NOT_FOUND for a missing record and for an unknown route, without echoing the path', async () => {
    const missing = await request(server)
      .get('/api/v1/test-errors/missing')
      .set('Authorization', `Bearer ${token}`);
    expectErrorShape(missing, 404, 'NOT_FOUND');
    expect(missing.body).toMatchObject({ message: 'Not found.', fieldErrors: {} });

    const route = await request(server)
      .get('/api/v1/no-such-route')
      .set('Authorization', `Bearer ${token}`);
    expectErrorShape(route, 404, 'NOT_FOUND');
    expect(route.text).not.toContain('no-such-route');
  });

  it('413 PAYLOAD_TOO_LARGE for a body over 100 KB', async () => {
    const res = await request(server)
      .post('/api/v1/test-errors/echo')
      .send({ data: 'x'.repeat(101 * KB) });
    expectErrorShape(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('400 INVALID_JSON for a malformed body', async () => {
    const res = await request(server)
      .post('/api/v1/test-errors/echo')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expectErrorShape(res, 400, 'INVALID_JSON');
  });

  it('500 INTERNAL_ERROR with a generic message; details go to the log only', async () => {
    const res = await request(server)
      .get('/api/v1/test-errors/boom')
      .set('Authorization', `Bearer ${token}`);
    expectErrorShape(res, 500, 'INTERNAL_ERROR');
    expect(res.text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|hunter2|stack/i);
    const logged = ctx.logLines.join('');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toContain((res.body as { requestId: string }).requestId);
  });
});

describe('request ID', () => {
  it('generates one per request and returns it in X-Request-Id', async () => {
    const a = await request(server).get('/api/v1/health');
    const b = await request(server).get('/api/v1/health');
    expect(a.headers['x-request-id']).toMatch(UUID);
    expect(b.headers['x-request-id']).toMatch(UUID);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('reuses a plain client-supplied ID and replaces an unsafe one', async () => {
    const kept = await request(server).get('/api/v1/health').set('X-Request-Id', 'web-abc12345');
    expect(kept.headers['x-request-id']).toBe('web-abc12345');

    // Values a client can send but the API must not echo into logs: spaces/quotes, or too long.
    for (const unsafe of ['bad id with "quotes" {}', 'a'.repeat(65)]) {
      const replaced = await request(server).get('/api/v1/health').set('X-Request-Id', unsafe);
      expect(replaced.headers['x-request-id']).toMatch(UUID);
    }
  });
});

describe('request logging (§11.7)', () => {
  interface LogLine {
    level: string;
    msg: string;
    req?: { id: string; method: string; path: string };
    res?: { statusCode: number };
    userId?: string;
    businessId?: string;
    responseTime?: number;
  }

  function parsedLines(): LogLine[] {
    return ctx.logLines.map((line) => JSON.parse(line) as LogLine);
  }

  it('writes one JSON line per request with the request ID, path, status and user', async () => {
    const res = await request(server)
      .get('/api/v1/test-errors/list?page=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const lines = parsedLines().filter((line) => line.req !== undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      req: { id: res.headers['x-request-id'], method: 'GET', path: '/api/v1/test-errors/list' },
      res: { statusCode: 200 },
      userId: USER_ID,
      businessId: TEST_BUSINESS_ID,
    });
    expect(typeof lines[0]?.responseTime).toBe('number');
  });

  it('logs no token, header, query string, body or personal data', async () => {
    await request(server)
      .get(`/api/v1/test-errors/list?q=${PHONE}&page=1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', 'sb=secret-cookie')
      .expect(200);
    await request(server)
      .post('/api/v1/test-errors/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nimali Perera', phone: PHONE, email: EMAIL, items: [] })
      .expect(400);
    await request(server)
      .get('/api/v1/test-errors/boom')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);

    const logged = ctx.logLines.join('');
    expect(ctx.logLines.length).toBeGreaterThanOrEqual(3);
    for (const forbidden of [token, 'Bearer', PHONE, EMAIL, 'Nimali', 'secret-cookie', 'q=']) {
      expect(logged).not.toContain(forbidden);
    }
    for (const line of parsedLines()) expect(line).not.toHaveProperty('req.headers');
  });

  it('logs 4xx as warn and 5xx as error', async () => {
    await request(server)
      .get('/api/v1/test-errors/missing')
      .set('Authorization', `Bearer ${token}`);
    await request(server).get('/api/v1/test-errors/boom').set('Authorization', `Bearer ${token}`);
    const levels = parsedLines()
      .filter((line) => line.res !== undefined)
      .map((line) => [line.res?.statusCode, line.level]);
    expect(levels).toEqual([
      [404, 'warn'],
      [500, 'error'],
    ]);
  });
});
