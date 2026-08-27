import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_DEFAULTS,
  BENCHMARK_LIMITS,
  createSuiteRequestSchema,
  runConfigurationSchema,
  startRunRequestSchema,
  suiteConfigurationSchema,
  SUITE_DEFAULTS,
  SUITE_LIMITS,
} from './configuration.js';

const requiredSelection = {
  broker: 'redis',
  scenario: 'fan-out',
} as const;

describe('startRunRequestSchema', () => {
  it('applies safe defaults', () => {
    expect(startRunRequestSchema.parse(requiredSelection)).toEqual({
      ...requiredSelection,
      name: null,
      description: null,
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

describe('suiteConfigurationSchema', () => {
  const suiteConfiguration = {
    workload: BENCHMARK_DEFAULTS,
    combinations: [
      { broker: 'redis', scenario: 'competing-consumers' },
      { broker: 'kafka', scenario: 'fan-out' },
    ],
    repetitions: 3,
    orderStrategy: 'rotating',
    cooldownMs: 1_000,
  } as const;

  it('validates a resolved suite configuration', () => {
    expect(suiteConfigurationSchema.parse(suiteConfiguration)).toEqual(
      suiteConfiguration,
    );
  });

  it('requires at least one unique combination', () => {
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        combinations: [],
      }).success,
    ).toBe(false);
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        combinations: [
          suiteConfiguration.combinations[0],
          suiteConfiguration.combinations[0],
        ],
      }).success,
    ).toBe(false);
  });

  it('requires positive repetitions and a non-negative cooldown', () => {
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        repetitions: 0,
      }).success,
    ).toBe(false);
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        cooldownMs: -1,
      }).success,
    ).toBe(false);
  });

  it('enforces suite field and generated-run limits', () => {
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        repetitions: SUITE_LIMITS.repetitions.max + 1,
      }).success,
    ).toBe(false);
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        cooldownMs: SUITE_LIMITS.cooldownMs.max + 1,
      }).success,
    ).toBe(false);
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        combinations: [
          { broker: 'redis', scenario: 'fan-out' },
          { broker: 'kafka', scenario: 'fan-out' },
          { broker: 'rabbitmq', scenario: 'fan-out' },
          { broker: 'redis', scenario: 'competing-consumers' },
          { broker: 'kafka', scenario: 'competing-consumers' },
          { broker: 'rabbitmq', scenario: 'competing-consumers' },
        ],
        repetitions: 20,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['consumerCount', 1, 64],
    ['producerConcurrency', 1, 32],
    ['payloadSizeBytes', 1, 1_048_576],
    ['messageCount', 1, 1_000_000],
  ] as const)(
    'accepts safe %s sweep boundaries',
    (parameter, minimum, maximum) => {
      expect(
        suiteConfigurationSchema.parse({
          ...suiteConfiguration,
          sweep: { parameter, values: [minimum, maximum] },
        }).sweep,
      ).toEqual({ parameter, values: [minimum, maximum] });
    },
  );

  it('rejects invalid sweep shapes and generated work above the suite cap', () => {
    for (const values of [[1], [1, 1], [2, 1], [0, 1]]) {
      expect(
        suiteConfigurationSchema.safeParse({
          ...suiteConfiguration,
          sweep: { parameter: 'consumerCount', values },
        }).success,
      ).toBe(false);
    }
    expect(
      suiteConfigurationSchema.safeParse({
        ...suiteConfiguration,
        combinations: suiteConfiguration.combinations.slice(0, 1),
        repetitions: 6,
        sweep: {
          parameter: 'messageCount',
          values: Array.from({ length: 20 }, (_, index) => index + 1),
        },
      }).success,
    ).toBe(false);
  });
});

describe('createSuiteRequestSchema', () => {
  it('resolves safe workload and suite defaults', () => {
    expect(
      createSuiteRequestSchema.parse({
        name: '  Default suite  ',
        combinations: [{ broker: 'kafka', scenario: 'fan-out' }],
      }),
    ).toEqual({
      name: 'Default suite',
      description: null,
      configuration: {
        workload: BENCHMARK_DEFAULTS,
        combinations: [{ broker: 'kafka', scenario: 'fan-out' }],
        ...SUITE_DEFAULTS,
      },
    });
  });
});
