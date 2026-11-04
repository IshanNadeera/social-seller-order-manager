import {
  DELIVERY_STATUSES,
  FULFILMENT_TYPES,
  ORDER_STAGES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SOURCE_CHANNELS,
  SRI_LANKA_DISTRICTS,
} from '@ssom/shared';
import { describe, expect, it } from 'vitest';
import { strings } from './strings';

describe('strings', () => {
  it.each(SOURCE_CHANNELS)('has a label for source channel %s', (channel) => {
    expect(strings.sourceChannel[channel].trim()).not.toBe('');
  });

  it('gives every source channel a different label', () => {
    const labels = SOURCE_CHANNELS.map((channel) => strings.sourceChannel[channel]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('district labels', () => {
  it.each(SRI_LANKA_DISTRICTS)('has a label for %s', (district) => {
    expect(strings.district[district].trim()).not.toBe('');
  });
});

describe('payment method and fulfilment labels', () => {
  it.each([...PAYMENT_METHODS])('has a label for payment method %s', (method) => {
    expect(strings.paymentMethod[method].trim()).not.toBe('');
  });

  it.each([...FULFILMENT_TYPES])('has a label for fulfilment type %s', (type) => {
    expect(strings.fulfilmentType[type].trim()).not.toBe('');
  });
});

describe('status labels', () => {
  const sets = [
    ['stage', ORDER_STAGES, strings.orderStage],
    ['order status', ORDER_STATUSES, strings.orderStatus],
    ['payment status', PAYMENT_STATUSES, strings.paymentStatus],
    ['delivery status', DELIVERY_STATUSES, strings.deliveryStatus],
  ] as const;

  it.each(sets)('every %s has a label, and no two share one', (_name, codes, labels) => {
    const texts = codes.map((code) => (labels as Record<string, string>)[code]?.trim() ?? '');
    expect(texts.every((text) => text !== '')).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
