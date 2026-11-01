// A18 (docs/DEVELOPMENT.md §9.8): 300 requests per minute per signed-in user. Users are limited
// separately; the 301st request gets 429 RATE_LIMITED in the §9.7 shape with Retry-After.
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_LIMIT } from '../src/common/user-throttler.guard';
import { startHttpTestApp } from './http-app';
import type { HttpTestApp } from './http-app';

const USER_A = '0b7c9a52-3f1e-4c9a-9f2b-5d6e7f809a1b';
const USER_B = '1c8dab63-4021-4dab-8a3c-6e7f8091a2b3';

@Controller('test-throttle')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

let ctx: HttpTestApp;
let app: NestExpressApplication;
let server: App;

beforeAll(async () => {
  ctx = await startHttpTestApp([PingController]);
  app = ctx.app;
  server = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe('per-user rate limit (§9.8)', () => {
  it('is 300 requests per minute', () => {
    expect(RATE_LIMIT).toEqual({ ttl: 60_000, limit: 300 });
  });

  it('allows 300 requests, refuses the 301st with RATE_LIMITED, and leaves other users unaffected', async () => {
    const tokenA = await ctx.auth.sign(USER_A, 'a@example.com');
    const tokenB = await ctx.auth.sign(USER_B, 'b@example.com');

    for (let i = 0; i < RATE_LIMIT.limit; i += 1) {
      const res = await request(server)
        .get('/api/v1/test-throttle')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status, `request ${i + 1}`).toBe(200);
    }

    const limited = await request(server)
      .get('/api/v1/test-throttle')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment and try again.',
      fieldErrors: {},
      requestId: limited.headers['x-request-id'],
    });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Same network address, different user: not limited.
    await request(server)
      .get('/api/v1/test-throttle')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  }, 30_000);
});
