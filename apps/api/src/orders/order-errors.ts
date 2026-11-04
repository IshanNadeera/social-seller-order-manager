import { UnprocessableEntityException } from '@nestjs/common';

/** A broken business rule (§9.7): 422 with the code, and the message on one field or on none. */
export function refuse(
  code: string,
  message: string,
  field?: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    message,
    fieldErrors: field === undefined ? {} : { [field]: message },
  });
}
