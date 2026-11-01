// Integration test for the HTTP setup in src/app.setup.ts: global prefix, helmet, CORS and body limit.
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Public } from '../src/auth/public.decorator';
import { configureApp } from '../src/app.setup';
import { testEnv } from './test-env';

const WEB_ORIGIN = testEnv.WEB_ORIGIN;
const KB = 1024;

/** Test-only route that accepts a JSON body, so the body limit can be exercised. Public: no token needed. */
@Public()
@Controller('test-echo')
class EchoController {
  @Post()
  @HttpCode(200)
  echo(@Body() body: { data?: string }): { length: number } {
    return { length: body.data?.length ?? 0 };
  }
}

function headersOf(res: Response): Record<string, string | undefined> {
  return res.headers;
}

describe('HTTP setup', () => {
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testEnv)],
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app, testEnv);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('global prefix', () => {
    it('serves routes under /api/v1', async () => {
      await request(server).get('/api/v1/health').expect(200, { status: 'ok' });
    });

    it('does not serve routes outside /api/v1', async () => {
      await request(server).get('/health').expect(404);
    });
  });

  describe('security headers', () => {
    it('sets helmet headers and hides the framework', async () => {
      const headers = headersOf(await request(server).get('/api/v1/health'));
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['strict-transport-security']).toBeDefined();
      expect(headers['content-security-policy']).toBeDefined();
      expect(headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('answers a preflight from the web origin', async () => {
      const res = await request(server)
        .options('/api/v1/health')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
      const headers = headersOf(res);
      expect(res.status).toBe(204);
      expect(headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(headers['access-control-allow-headers']).toBe(
        'Authorization,Content-Type,Idempotency-Key',
      );
      expect(headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('allows simple requests from the web origin', async () => {
      const res = await request(server).get('/api/v1/health').set('Origin', WEB_ORIGIN);
      expect(headersOf(res)['access-control-allow-origin']).toBe(WEB_ORIGIN);
    });

    it.each([
      'https://evil.example',
      'http://localhost:5174',
      'http://localhost:5173.evil.example',
    ])('gives no CORS access to %s', async (origin) => {
      const res = await request(server)
        .options('/api/v1/health')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
      expect(headersOf(res)['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('body limit', () => {
    it('accepts a JSON body under 100 KB', async () => {
      const data = 'x'.repeat(90 * KB);
      await request(server).post('/api/v1/test-echo').send({ data }).expect(200, {
        length: data.length,
      });
    });

    it('rejects a JSON body over 100 KB with 413', async () => {
      await request(server)
        .post('/api/v1/test-echo')
        .send({ data: 'x'.repeat(101 * KB) })
        .expect(413);
    });
  });
});
