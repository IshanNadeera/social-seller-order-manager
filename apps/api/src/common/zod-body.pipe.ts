// Request validation with shared Zod schemas (owner decision in A16: shared Zod schemas instead of
// class-validator DTOs, so the API and the web forms apply the same rules). Schemas are strict:
// unknown fields are refused, never silently dropped (the forbidNonWhitelisted rule of §9.8).
//
//   create(@Body(new ZodBodyPipe(onboardingRequestSchema)) input: OnboardingInput)
//   list(@Query(new ZodQueryPipe(orderListQuerySchema)) query: OrderListQuery)
import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** §9.7 validation error body (the exception filter adds requestId). */
export interface ValidationErrorBody {
  code: 'VALIDATION_ERROR';
  message: string;
  fieldErrors: Record<string, string>;
}

/** Path → "items[0].quantity" (the key format of §9.7's fieldErrors). */
function fieldKey(path: readonly PropertyKey[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${String(part)}`,
    )
    .join('');
}

/** Turns Zod issues into one plain-language message per field (the first issue wins). */
export function toFieldErrors(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        fieldErrors[fieldKey([...issue.path, key])] ??= 'This field is not allowed.';
      }
      continue;
    }
    const key = fieldKey(issue.path);
    if (key !== '') fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

type Source = 'body' | 'query';

const NOT_AN_OBJECT: Record<Source, string> = {
  body: 'The request body must be a JSON object with the expected fields.',
  query: 'The query parameters are not valid.',
};

/** Parses `value` with `schema` or throws 400 VALIDATION_ERROR with field errors. */
function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  source: Source,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fieldErrors = toFieldErrors(result.error.issues);
  const body: ValidationErrorBody = {
    code: 'VALIDATION_ERROR',
    message:
      Object.keys(fieldErrors).length > 0
        ? 'Please check the highlighted fields.'
        : NOT_AN_OBJECT[source],
    fieldErrors,
  };
  throw new BadRequestException(body);
}

/** Validates @Body() against a shared Zod schema; returns the parsed (trimmed, transformed) value. */
export class ZodBodyPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<Schema> {
    if (metadata.type !== 'body') throw new Error('ZodBodyPipe is for @Body() only.');
    return parseOrThrow(this.schema, value, 'body');
  }
}

/**
 * Validates the whole query string (@Query() without a name) against a strict Zod schema.
 * Query values arrive as strings: use z.coerce / transforms in the schema for numbers and dates.
 */
export class ZodQueryPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<Schema> {
    if (metadata.type !== 'query' || metadata.data !== undefined) {
      throw new Error('ZodQueryPipe is for the whole @Query() only.');
    }
    return parseOrThrow(this.schema, value, 'query');
  }
}
