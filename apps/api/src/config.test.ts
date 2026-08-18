import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('provides working local defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3_000,
      databaseUrl: './data/messaging-lab.sqlite',
      redisUrl: 'redis://:messaging@localhost:6379',
      kafkaBrokers: ['localhost:9092'],
      rabbitMqUrl: 'amqp://messaging:messaging@localhost:5672',
      rabbitMqManagementUrl: 'http://localhost:15672',
    });
  });

  it('parses explicit ports and broker lists', () => {
    const config = loadConfig({
      API_PORT: '4000',
      KAFKA_BROKERS: 'kafka-1:9092, kafka-2:9092',
    });

    expect(config.port).toBe(4_000);
    expect(config.kafkaBrokers).toEqual(['kafka-1:9092', 'kafka-2:9092']);
  });

  it('rejects invalid environment values', () => {
    expect(() => loadConfig({ API_PORT: '0' })).toThrow(ZodError);
    expect(() => loadConfig({ REDIS_URL: 'not a URL' })).toThrow(ZodError);
    expect(() => loadConfig({ KAFKA_BROKERS: '   ' })).toThrow(ZodError);
    expect(() => loadConfig({ KAFKA_BROKERS: 'kafka-without-port' })).toThrow(
      ZodError,
    );
  });
});
