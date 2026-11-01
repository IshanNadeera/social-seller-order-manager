// Structured JSON logging with pino (docs/DEVELOPMENT.md §11.7, §9.8, §11.5).
// Rules: one line per request with a request ID; never log tokens, Authorization headers, request
// bodies, query strings or personal data (names, phones, emails, addresses).
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerService } from '@nestjs/common';
import { pino } from 'pino';
import type { DestinationStream, Logger, LevelWithSilent } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Env } from '../env';

/** Field names that must never appear in a log line, wherever they are nested (two levels). */
const REDACTED_KEYS = ['authorization', 'cookie', 'token', 'password', 'email', 'phone'];
export const REDACT_PATHS = [
  'req.headers',
  ...REDACTED_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: env.LOG_LEVEL satisfies LevelWithSilent,
      base: { service: 'ssom-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}

/** A client-supplied X-Request-Id is reused only if it is short and plain; otherwise a new one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestIdFor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

/** The parts of a request that may be logged (path without the query string). */
interface LoggedRequest {
  id: string;
  method: string;
  path: string;
}

type RequestWithContext = IncomingMessage & {
  id?: string;
  user?: { userId?: string };
  auth?: { businessId?: string };
};

/**
 * Express middleware: assigns the request ID (req.id + X-Request-Id response header) and logs one
 * line per finished request: method, path, status, duration, user and business IDs. Nothing else.
 */
export function requestLogging(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = requestIdFor(req.headers['x-request-id']);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, error) =>
      error !== undefined || res.statusCode >= 500
        ? 'error'
        : res.statusCode >= 400
          ? 'warn'
          : 'info',
    customSuccessMessage: (req, res) => `${req.method} ${pathOf(req.url)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req.url)} ${res.statusCode}`,
    customProps: (req: IncomingMessage) => {
      const { user, auth } = req as RequestWithContext;
      return { userId: user?.userId, businessId: auth?.businessId };
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }): LoggedRequest => ({
        id: req.id,
        method: req.method,
        path: pathOf(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

/** "/api/v1/customers?q=0771234567" → "/api/v1/customers". Query strings may hold personal data. */
export function pathOf(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

/** Sends Nest's own log calls (Logger.log/warn/error...) to pino as JSON. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  /** Nest passes (message, [stack], [context]); the context is the last string argument. */
  private write(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: unknown,
    rest: unknown[],
  ): void {
    const last = rest.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    const stack =
      level === 'error' && rest.length >= 2 && typeof rest[0] === 'string' ? rest[0] : undefined;
    const text =
      message instanceof Error
        ? message.message
        : typeof message === 'string'
          ? message
          : JSON.stringify(message);
    this.logger[level]({ context, ...(stack === undefined ? {} : { stack }) }, text);
  }
}
