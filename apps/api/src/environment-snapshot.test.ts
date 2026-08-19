import { describe, expect, it } from 'vitest';

import type { ApiConfig } from './config.js';
import { captureEnvironmentSnapshot } from './environment-snapshot.js';

const config: ApiConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3_000,
  databaseUrl: '/private/data.sqlite',
  redisUrl: 'rediss://user:secret@private-redis.example:6379',
  kafkaBrokers: ['private-kafka-1:9092', 'private-kafka-2:9092'],
  rabbitMqUrl: 'amqp://user:secret@private-rabbit.example:5672',
  rabbitMqManagementUrl: 'http://private-rabbit.example:15672',
};

describe('captureEnvironmentSnapshot', () => {
  it('captures reproducibility metadata without identifiers or endpoints', () => {
    const snapshot = captureEnvironmentSnapshot(
      config,
      {
        MESSAGING_LAB_VERSION: '1.2.3',
        MESSAGING_LAB_COMMIT: 'abcdef123',
        REDIS_IMAGE: 'redis:9.0.1-alpine',
        KAFKA_IMAGE: 'registry.example/apache/kafka:5.1.0',
        RABBITMQ_IMAGE: 'rabbitmq@sha256:abcdef',
      },
      () => new Date('2026-08-19T12:00:00.000Z'),
    );

    expect(snapshot).toMatchObject({
      capturedAt: '2026-08-19T12:00:00.000Z',
      application: { version: '1.2.3', commit: 'abcdef123' },
      brokers: {
        redis: { version: '9.0.1' },
        kafka: { version: '5.1.0' },
        rabbitmq: { version: null },
      },
      adapterConfiguration: {
        redis: { transport: 'tls' },
        kafka: { brokerCount: 2 },
        rabbitmq: { transport: 'tcp', prefetch: 100 },
      },
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('registry.example');
    expect(serialized).not.toContain('data.sqlite');
  });
});
