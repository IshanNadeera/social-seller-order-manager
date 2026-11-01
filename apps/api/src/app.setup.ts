import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from './common/env';

/** Every route lives under this prefix (docs/DEVELOPMENT.md §9). */
export const API_PREFIX = 'api/v1';

/** Largest accepted request body (docs/DEVELOPMENT.md §11.4). */
export const BODY_LIMIT = '100kb';

/**
 * HTTP-level setup shared by main.ts and the tests, so the tests exercise the real configuration.
 * The app must be created with `{ bodyParser: false }` so the body limit below is the only JSON parser.
 */
export function configureApp(app: NestExpressApplication, env: Pick<Env, 'WEB_ORIGIN'>): void {
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  app.use(helmet());
  // JSON only: the API accepts no form posts or file uploads.
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.enableCors({
    // An array (not a plain string) makes the cors package echo the origin only when it matches exactly,
    // and send no Access-Control-Allow-Origin header to any other origin.
    origin: [env.WEB_ORIGIN],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    // Bearer tokens, not cookies (§11.2), so credentials stay off.
    credentials: false,
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
