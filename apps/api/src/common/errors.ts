// The one error shape of the API (docs/DEVELOPMENT.md §9.7): { code, message, fieldErrors, requestId }.
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody } from '@ssom/shared';

/** Default code and plain-language message per status, for errors thrown without their own code. */
const DEFAULTS: Record<number, { code: string; message: string }> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'BAD_REQUEST',
    message: 'The request could not be understood.',
  },
  [HttpStatus.UNAUTHORIZED]: { code: 'UNAUTHORIZED', message: 'Please sign in again.' },
  [HttpStatus.FORBIDDEN]: { code: 'FORBIDDEN', message: 'You do not have access to this.' },
  [HttpStatus.NOT_FOUND]: { code: 'NOT_FOUND', message: 'Not found.' },
  [HttpStatus.METHOD_NOT_ALLOWED]: {
    code: 'METHOD_NOT_ALLOWED',
    message: 'This action is not supported here.',
  },
  [HttpStatus.CONFLICT]: {
    code: 'CONFLICT',
    message: 'This conflicts with a change made elsewhere. Please reload and try again.',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request is too large.',
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: 'UNPROCESSABLE',
    message: 'This action is not allowed right now.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please wait a moment and try again.',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is temporarily unavailable. Please try again shortly.',
  },
};

const INTERNAL = {
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong on our side. Please try again.',
};

function defaultsFor(status: number): { code: string; message: string } {
  return (
    DEFAULTS[status] ??
    (status >= 500 ? INTERNAL : { code: 'ERROR', message: 'The request failed.' })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * Builds the response for any thrown value.
 * - HttpException with its own { code, message, fieldErrors? } (our errors): kept as is.
 * - Other HttpExceptions (framework, e.g. a bare UnauthorizedException): status default code/message.
 * - Anything else: 500 INTERNAL_ERROR with a generic message. Details go to the log only.
 */
export function errorResponse(
  exception: unknown,
  requestId: string,
): { status: number; body: ApiErrorBody } {
  if (!(exception instanceof HttpException)) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { ...INTERNAL, fieldErrors: {}, requestId },
    };
  }
  const status = exception.getStatus();
  const fallback = defaultsFor(status);
  const raw = exception.getResponse();
  const ours = isRecord(raw) && typeof raw['code'] === 'string' ? raw : undefined;
  const body: ApiErrorBody = {
    code: ours ? String(ours['code']) : fallback.code,
    message: ours && typeof ours['message'] === 'string' ? ours['message'] : fallback.message,
    fieldErrors: ours ? stringRecord(ours['fieldErrors']) : {},
    requestId,
  };
  // 5xx never carry details, whatever was thrown.
  if (status >= 500 && !ours) return { status, body: { ...body, ...fallback } };
  return { status, body };
}

/** Errors raised by the JSON body parser before Nest's pipeline (they carry `type` and `status`). */
export function bodyParserErrorResponse(
  error: { type?: unknown; status?: unknown },
  requestId: string,
): { status: number; body: ApiErrorBody } {
  if (error.type === 'entity.too.large') {
    return { status: 413, body: { ...defaultsFor(413), fieldErrors: {}, requestId } };
  }
  if (error.type === 'entity.parse.failed') {
    return {
      status: 400,
      body: {
        code: 'INVALID_JSON',
        message: 'The request body is not valid JSON.',
        fieldErrors: {},
        requestId,
      },
    };
  }
  const status =
    typeof error.status === 'number' && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
  return { status, body: { ...defaultsFor(status), fieldErrors: {}, requestId } };
}
