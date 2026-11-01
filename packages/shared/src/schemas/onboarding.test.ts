import { describe, expect, it } from 'vitest';
import { onboardingRequestSchema } from '../index.js';

const parse = (body: unknown) => onboardingRequestSchema.safeParse(body);

describe('onboardingRequestSchema', () => {
  it('accepts a name only', () => {
    expect(parse({ businessName: 'Nimali Fashions' })).toEqual({
      success: true,
      data: { businessName: 'Nimali Fashions', contactPhone: null },
    });
  });

  it('trims values, uppercases the prefix and keeps the phone as typed', () => {
    const result = parse({
      businessName: '  Nimali  ',
      contactPhone: ' 077 000 0001 ',
      orderPrefix: ' nim ',
    });
    expect(result.success && result.data).toEqual({
      businessName: 'Nimali',
      contactPhone: '077 000 0001',
      orderPrefix: 'NIM',
    });
  });

  it('treats an empty phone as no phone', () => {
    expect(parse({ businessName: 'X Shop', contactPhone: '   ' }).data?.contactPhone).toBeNull();
  });

  it.each([{}, { businessName: '' }, { businessName: '   ' }, { businessName: 42 }])(
    'requires a business name (%j)',
    (body) => {
      const result = parse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['businessName']);
      expect(result.error?.issues[0]?.message).toBe('Enter your business name.');
    },
  );

  it('limits the business name to 100 characters', () => {
    expect(parse({ businessName: 'x'.repeat(100) }).success).toBe(true);
    expect(parse({ businessName: 'x'.repeat(101) }).success).toBe(false);
  });

  it.each(['N', 'TOOLONG', 'NI-M', 'NIM!', 'නිම'])('rejects order prefix %j', (orderPrefix) => {
    const result = parse({ businessName: 'Shop', orderPrefix });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['orderPrefix']);
  });

  it.each(['NI', 'NIM', 'ABC123', 'ord'])('accepts order prefix %j', (orderPrefix) => {
    expect(parse({ businessName: 'Shop', orderPrefix }).success).toBe(true);
  });

  it('rejects unknown fields such as a client-supplied businessId (§9.5, §11.1)', () => {
    const result = parse({ businessName: 'Shop', businessId: 'b-1' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});
