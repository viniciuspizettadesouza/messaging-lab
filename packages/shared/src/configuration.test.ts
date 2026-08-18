import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  BENCHMARK_LIMITS,
  runConfigurationSchema,
  startRunRequestSchema,
} from './configuration.js';

const requiredSelection = {
  broker: 'redis',
  scenario: 'fan-out',
} as const;

describe('startRunRequestSchema', () => {
  it('applies safe defaults', () => {
    expect(startRunRequestSchema.parse(requiredSelection)).toEqual({
      ...requiredSelection,
      ...BENCHMARK_DEFAULTS,
    });
  });

  it('rejects unknown fields', () => {
    expect(() =>
      startRunRequestSchema.parse({ ...requiredSelection, unexpected: true }),
    ).toThrow();
  });

  it('rejects unknown brokers and scenarios', () => {
    expect(() =>
      startRunRequestSchema.parse({ ...requiredSelection, broker: 'unknown' }),
    ).toThrow();
    expect(() =>
      startRunRequestSchema.parse({ ...requiredSelection, scenario: 'queue' }),
    ).toThrow();
  });

  it.each(Object.entries(BENCHMARK_LIMITS))(
    'accepts the inclusive %s boundaries',
    (field, limits) => {
      expect(
        startRunRequestSchema.parse({
          ...requiredSelection,
          [field]: limits.min,
        }),
      ).toMatchObject({ [field]: limits.min });
      expect(
        startRunRequestSchema.parse({
          ...requiredSelection,
          [field]: limits.max,
        }),
      ).toMatchObject({ [field]: limits.max });
    },
  );

  it.each(Object.entries(BENCHMARK_LIMITS))(
    'rejects values outside the %s boundaries',
    (field, limits) => {
      expect(() =>
        startRunRequestSchema.parse({
          ...requiredSelection,
          [field]: limits.min - 1,
        }),
      ).toThrow();
      expect(() =>
        startRunRequestSchema.parse({
          ...requiredSelection,
          [field]: limits.max + 1,
        }),
      ).toThrow();
    },
  );

  it('rejects fractional numeric inputs', () => {
    expect(() =>
      startRunRequestSchema.parse({ ...requiredSelection, messageCount: 1.5 }),
    ).toThrow();
  });
});

describe('runConfigurationSchema', () => {
  it('requires a fully resolved configuration', () => {
    expect(() => runConfigurationSchema.parse(requiredSelection)).toThrow();
  });
});
