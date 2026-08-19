import type { EnvironmentSnapshot } from '@messaging-lab/shared';

export const testEnvironmentSnapshot: EnvironmentSnapshot = {
  capturedAt: '2026-08-19T12:00:00.000Z',
  application: { version: '0.1.0-test', commit: 'abc1234' },
  runtime: { nodeVersion: 'v22.18.0' },
  host: {
    platform: 'linux',
    release: 'test',
    architecture: 'x64',
    logicalCpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
  },
  brokers: {
    redis: { image: 'redis:8.2.1-alpine3.22', version: '8.2.1' },
    kafka: { image: 'apache/kafka:4.0.0', version: '4.0.0' },
    rabbitmq: {
      image: 'rabbitmq:4.1.3-management-alpine',
      version: '4.1.3',
    },
  },
  adapterConfiguration: {
    redis: { transport: 'tcp', client: 'redis@6.2.1' },
    kafka: {
      transport: 'tcp',
      client: 'kafkajs@2.2.4',
      brokerCount: 1,
      producerAcknowledgements: 'all',
      automaticTopicCreation: false,
    },
    rabbitmq: { transport: 'tcp', client: 'amqplib@2.0.1', prefetch: 100 },
  },
};
