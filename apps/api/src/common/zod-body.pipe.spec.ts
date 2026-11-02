import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodBodyPipe, ZodQueryPipe } from './zod-body.pipe';

const body: ArgumentMetadata = { type: 'body' };

const schema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name.'),
  items: z.array(z.strictObject({ quantity: z.number().int().min(1, 'Must be at least 1') })),
});

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the pipe to throw');
}

describe('ZodBodyPipe', () => {
  const pipe = new ZodBodyPipe(schema);

  it('returns the parsed value', () => {
    expect(pipe.transform({ name: ' A ', items: [{ quantity: 2 }] }, body)).toEqual({
      name: 'A',
      items: [{ quantity: 2 }],
    });
  });

  it('answers 400 VALIDATION_ERROR with one message per field (§9.7)', () => {
    const error = errorOf(() =>
      pipe.transform({ name: '', items: [{ quantity: 1 }, { quantity: 0 }] }, body),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      fieldErrors: { name: 'Enter a name.', 'items[1].quantity': 'Must be at least 1' },
    });
  });

  it('refuses unknown fields, including nested ones', () => {
    const error = errorOf(() =>
      pipe.transform(
        { name: 'A', businessId: 'x', items: [{ quantity: 1, totalAmount: 9 }] },
        body,
      ),
    );
    expect((error as BadRequestException).getResponse()).toMatchObject({
      fieldErrors: {
        businessId: 'This field is not allowed.',
        'items[0].totalAmount': 'This field is not allowed.',
      },
    });
  });

  it.each([undefined, null, 'text', 42, []])(
    'refuses a body that is not an object (%j)',
    (value) => {
      const error = errorOf(() => pipe.transform(value, body));
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'The request body must be a JSON object with the expected fields.',
        fieldErrors: {},
      });
    },
  );

  it('is only for request bodies', () => {
    expect(() => pipe.transform({}, { type: 'query' })).toThrow(/@Body\(\) only/);
  });
});

describe('ZodQueryPipe', () => {
  const querySchema = z.strictObject({
    page: z.coerce.number().int().min(1, 'Must be 1 or more').default(1),
    q: z.string().trim().max(100).optional(),
  });
  const pipe = new ZodQueryPipe(querySchema);
  const query: ArgumentMetadata = { type: 'query' };

  it('parses and coerces the query string', () => {
    expect(pipe.transform({ page: '2', q: ' kasun ' }, query)).toEqual({ page: 2, q: 'kasun' });
    expect(pipe.transform({}, query)).toEqual({ page: 1 });
  });

  it('refuses unknown query parameters, such as businessId', () => {
    const error = errorOf(() => pipe.transform({ businessId: 'x' }, query));
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { businessId: 'This field is not allowed.' },
    });
  });

  it('reports invalid values per field', () => {
    const error = errorOf(() => pipe.transform({ page: '0' }, query));
    expect((error as BadRequestException).getResponse()).toMatchObject({
      fieldErrors: { page: 'Must be 1 or more' },
    });
  });

  it('is only for the whole query string', () => {
    expect(() => pipe.transform({}, { type: 'body' })).toThrow(/whole @Query\(\) only/);
    expect(() => pipe.transform('1', { type: 'query', data: 'page' })).toThrow(
      /whole @Query\(\) only/,
    );
  });
});

describe('whole-request rules', () => {
  const atLeastOne = z
    .strictObject({ name: z.string().optional(), phone: z.string().optional() })
    .refine((input) => Object.values(input).some((value) => value !== undefined), {
      message: 'Change at least one field.',
    });

  it('shows a rule about the request as a whole as the message', () => {
    try {
      new ZodBodyPipe(atLeastOne).transform({}, body);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Change at least one field.',
        fieldErrors: {},
      });
    }
  });

  it('still explains a body that is not an object', () => {
    try {
      new ZodBodyPipe(atLeastOne).transform('text', body);
      expect.unreachable();
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'The request body must be a JSON object with the expected fields.',
      });
    }
  });
});
