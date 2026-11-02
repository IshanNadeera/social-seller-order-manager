import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { moneySchema, toMoneyString } from './money.js';

const amount = z.strictObject({ amount: moneySchema('Enter the price.') });
const parse = (value: unknown) => amount.safeParse({ amount: value });
const firstMessage = (value: unknown) => parse(value).error?.issues[0]?.message;

describe('moneySchema', () => {
  it.each([
    ['1500', '1500.00'],
    ['1500.5', '1500.50'],
    ['0', '0.00'],
    ['0.05', '0.05'],
    [' 12.30 ', '12.30'],
    ['99999999.99', '99999999.99'],
  ])('accepts %j as %s', (input, output) => {
    expect(parse(input)).toEqual({ success: true, data: { amount: output } });
  });

  it.each(['-1', '01', '1.234', '100000000', '1,500', '1e3', '.5', '5.'])('refuses %j', (input) => {
    expect(firstMessage(input)).toBe(
      'Enter an amount from 0 to 99,999,999.99, with at most 2 decimals.',
    );
  });

  it('asks for the amount when it is missing or blank, with one message', () => {
    expect(amount.safeParse({}).error?.issues.map((issue) => issue.message)).toEqual([
      'Enter the price.',
    ]);
    expect(parse('  ').error?.issues.map((issue) => issue.message)).toEqual(['Enter the price.']);
  });

  it('refuses JavaScript numbers: money travels as text (§7.5)', () => {
    expect(firstMessage(1500)).toBe('Enter the amount as text, like "1500.00".');
  });
});

describe('toMoneyString', () => {
  it('always gives two decimals', () => {
    expect(toMoneyString('7')).toBe('7.00');
    expect(toMoneyString('7.5')).toBe('7.50');
    expect(toMoneyString('7.25')).toBe('7.25');
  });
});
