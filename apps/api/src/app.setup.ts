import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Env } from './common/env';
import { HttpErrorFilter, bodyParserErrorHandler } from './common/http-error.filter';
import { createLogger, requestLogging } from './common/logging/logger';

/** Every route lives under this prefix (docs/DEVELOPMENT.md §9). */
export const API_PREFIX = 'api/v1';

/** Largest accepted request body (docs/DEVELOPMENT.md §11.4). */
export const BODY_LIMIT = '100kb';

export interface ConfigureAppOptions {
  /** The pino logger; main.ts passes the app's logger, tests may pass one that captures lines. */
  logger?: Logger;
}

/**
 * HTTP-level setup shared by main.ts and the tests, so the tests exercise the real configuration.
 * The app must be created with `{ bodyParser: false }` so the body limit below is the only JSON parser.
 * Order matters: request ID + logging first, so every response (errors included) carries X-Request-Id.
 */
export function configureApp(
  app: NestExpressApplication,
  env: Pick<Env, 'WEB_ORIGIN' | 'LOG_LEVEL'>,
  options: ConfigureAppOptions = {},
): Logger {
  const logger = options.logger ?? createLogger(env);
  app.use(requestLogging(logger));
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  app.use(helmet());
  // JSON only: the API accepts no form posts or file uploads.
  app.useBodyParser('json', { limit: BODY_LIMIT });
  // Body-parser failures (too large, malformed JSON) happen before Nest's filters: same error shape.
  app.use(bodyParserErrorHandler(logger));
  app.enableCors({
    // An array (not a plain string) makes the cors package echo the origin only when it matches exactly,
    // and send no Access-Control-Allow-Origin header to any other origin.
    origin: [env.WEB_ORIGIN],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    // Lets the web app show the request ID when something fails (§9.7).
    exposedHeaders: ['X-Request-Id'],
    // Bearer tokens, not cookies (§11.2), so credentials stay off.
    credentials: false,
    maxAge: 600,
  });
  // Every error leaves as { code, message, fieldErrors, requestId } (§9.7).
  app.useGlobalFilters(new HttpErrorFilter(logger));
  app.enableShutdownHooks();
  return logger;
}
