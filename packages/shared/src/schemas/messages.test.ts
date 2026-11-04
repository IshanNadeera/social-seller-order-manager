// Plain-language validation messages (docs/DEVELOPMENT.md §6.9, §9.7): whatever a client sends,
// every field error is written for sellers, never zod's built-in wording ("Invalid input: expected
// string, received number"). New fields of these schemas are covered automatically.
// Not checked here: unknown fields (the API shows "This field is not allowed.") and a body that is
// not an object at all (the API answers with its own message), see apps/api/src/common/zod-body.pipe.ts.
import { describe, expect, it } from 'vitest';
import {
  addressCreateSchema,
  addressUpdateSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerOrdersQuerySchema,
  customerUpdateSchema,
  deliveryDispatchSchema,
  deliveryFailedSchema,
  deliveryReturnedSchema,
  deliveryUpdateSchema,
  onboardingRequestSchema,
  orderCancelSchema,
  orderCreateSchema,
  orderStatusChangeSchema,
  orderUpdateSchema,
  paymentCreateSchema,
  codSettleSchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
} from '../index.js';

const SCHEMAS = {
  onboardingRequestSchema,
  customerCreateSchema,
  customerUpdateSchema,
  customerListQuerySchema,
  addressCreateSchema,
  addressUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  productListQuerySchema,
  orderCreateSchema,
  orderUpdateSchema,
  orderStatusChangeSchema,
  orderCancelSchema,
  customerOrdersQuerySchema,
  paymentCreateSchema,
  codSettleSchema,
  deliveryUpdateSchema,
  deliveryDispatchSchema,
  deliveryFailedSchema,
  deliveryReturnedSchema,
};

/** Wrong types and sizes a client could send for any field. */
const BAD_VALUES: unknown[] = [
  12345,
  true,
  [],
  ['a', 'b'],
  {},
  null,
  '  ',
  'x'.repeat(5000),
  [{}],
  [5],
];

/** zod's own English wording. */
const BUILT_IN = /invalid input|expected|received|too small|too big|unrecognized/i;

describe('validation messages are plain language', () => {
  it.each(Object.entries(SCHEMAS))('%s', (_name, schema) => {
    const problems: string[] = [];
    for (const field of Object.keys(schema.shape)) {
      for (const value of BAD_VALUES) {
        const result = schema.safeParse({ [field]: value });
        for (const issue of result.error?.issues ?? []) {
          if (issue.code === 'unrecognized_keys' || issue.path.length === 0) continue;
          if (BUILT_IN.test(issue.message)) {
            problems.push(`${issue.path.join('.')} = ${JSON.stringify(value)}: ${issue.message}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
