import type { PipeTransform } from '@nestjs/common';
import { notFound } from './tenant';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an ID path parameter: `@Param('id', IdParamPipe) id: string`.
 * A value that is not a UUID gets the same 404 as an unknown or another business's ID (§9.7),
 * instead of a 500 from the database cast or a 400 that would reveal how IDs are checked.
 */
export class IdParamPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw notFound();
    return value.toLowerCase();
  }
}
