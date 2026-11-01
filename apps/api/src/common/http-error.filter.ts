import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { bodyParserErrorResponse, errorResponse } from './errors';
import { requestIdFor } from './logging/logger';

/** The request ID set by the request-logging middleware (falls back to a fresh one). */
function requestIdOf(request: Request): string {
  const id = (request as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : requestIdFor(undefined);
}

/**
 * Global exception filter (§9.7): every error leaves the API as { code, message, fieldErrors, requestId }.
 * Unexpected errors are logged with their stack and answered with a generic 500.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = requestIdOf(request);
    const { status, body } = errorResponse(exception, requestId);

    if (!(exception instanceof HttpException) || status >= 500) {
      this.logger.error({ requestId, err: exception }, 'Unhandled error');
    }
    if (response.headersSent) return;
    response.status(status).setHeader('Cache-Control', 'no-store').json(body);
  }
}

/**
 * Express error middleware for failures inside earlier middleware (the JSON body parser: body too
 * large, malformed JSON), which happen before Nest's exception filters can see them.
 */
export function bodyParserErrorHandler(logger: Logger) {
  return (error: unknown, request: Request, response: Response, next: NextFunction): void => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const requestId = requestIdOf(request);
    const details =
      typeof error === 'object' && error !== null
        ? (error as { type?: unknown; status?: unknown })
        : {};
    const { status, body } = bodyParserErrorResponse(details, requestId);
    if (status >= 500) logger.error({ requestId, err: error }, 'Request failed before routing');
    response.status(status).setHeader('Cache-Control', 'no-store').json(body);
  };
}
