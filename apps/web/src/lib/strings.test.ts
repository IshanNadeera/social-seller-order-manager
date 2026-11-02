import { SOURCE_CHANNELS, SRI_LANKA_DISTRICTS } from '@ssom/shared';
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
