// The Idempotency-Key header (docs/DEVELOPMENT.md §9.8, ADR-017): required on POST /orders,
// POST /orders/:id/payments and POST /orders/:id/cod/settle. The browser sends a new UUID per action.
import { BadRequestException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads and checks the header; refuses the request with 400 when it is missing or not a UUID. */
export function readIdempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? undefined : header?.trim();
  if (value === undefined || value === '') {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'This request needs an Idempotency-Key header, so a retry can’t create it twice.',
    });
  }
  if (!UUID.test(value)) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'The Idempotency-Key header must be a UUID.',
    });
  }
  return value.toLowerCase();
}

/** `@IdempotencyKey() key: string` in a controller method. */
export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  readIdempotencyKey(context.switchToHttp().getRequest<Request>().headers['idempotency-key']),
);
