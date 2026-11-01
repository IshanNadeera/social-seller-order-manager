import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** §9.7 validation error body. A18 adds requestId and makes every error follow this shape. */
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
      // Unknown fields are refused, never ignored (like forbidNonWhitelisted, §9.8).
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

/**
 * Validates a request body against a shared Zod schema (decision: shared Zod schemas instead of
 * class-validator DTOs, so the API and the web forms apply the same rules). Strict schemas reject
 * unknown fields. Returns the parsed (trimmed, transformed) value.
 *
 *   create(@Body(new ZodBodyPipe(onboardingRequestSchema)) input: OnboardingInput)
 */
export class ZodBodyPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<Schema> {
    if (metadata.type !== 'body') {
      throw new Error('ZodBodyPipe is for @Body() only.');
    }
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors = toFieldErrors(result.error.issues);
    const body: ValidationErrorBody = {
      code: 'VALIDATION_ERROR',
      message:
        Object.keys(fieldErrors).length > 0
          ? 'Please check the highlighted fields.'
          : 'The request body must be a JSON object with the expected fields.',
      fieldErrors,
    };
    throw new BadRequestException(body);
  }
}
