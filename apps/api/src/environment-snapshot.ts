import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';

import {
  environmentSnapshotSchema,
  type EnvironmentSnapshot,
} from '@messaging-lab/shared';

import type { ApiConfig } from './config.js';

const DEFAULT_IMAGES = {
  redis: 'redis:8.2.1-alpine3.22',
  kafka: 'apache/kafka:4.0.0',
  rabbitmq: 'rabbitmq:4.1.3-management-alpine',
} as const;
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
  dependencies: Record<string, string>;
};

export function captureEnvironmentSnapshot(
  config: ApiConfig,
  environment: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): EnvironmentSnapshot {
  const images = {
    redis: sanitizeImage(environment.REDIS_IMAGE ?? DEFAULT_IMAGES.redis),
    kafka: sanitizeImage(environment.KAFKA_IMAGE ?? DEFAULT_IMAGES.kafka),
    rabbitmq: sanitizeImage(
      environment.RABBITMQ_IMAGE ?? DEFAULT_IMAGES.rabbitmq,
    ),
  };
  return environmentSnapshotSchema.parse({
    capturedAt: now().toISOString(),
    application: {
      version: environment.MESSAGING_LAB_VERSION ?? packageMetadata.version,
      commit: environment.MESSAGING_LAB_COMMIT || null,
    },
    runtime: { nodeVersion: process.version },
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      logicalCpuCount: Math.max(1, cpus().length),
      totalMemoryBytes: totalmem() || null,
    },
    brokers: {
      redis: { image: images.redis, version: imageVersion(images.redis) },
      kafka: { image: images.kafka, version: imageVersion(images.kafka) },
      rabbitmq: {
        image: images.rabbitmq,
        version: imageVersion(images.rabbitmq),
      },
    },
    adapterConfiguration: {
      redis: {
        transport:
          new URL(config.redisUrl).protocol === 'rediss:' ? 'tls' : 'tcp',
        client: `redis@${packageMetadata.dependencies.redis ?? 'unknown'}`,
      },
      kafka: {
        transport: 'tcp',
        client: `kafkajs@${packageMetadata.dependencies.kafkajs ?? 'unknown'}`,
        brokerCount: config.kafkaBrokers.length,
        producerAcknowledgements: 'all',
        automaticTopicCreation: false,
      },
      rabbitmq: {
        transport:
          new URL(config.rabbitMqUrl).protocol === 'amqps:' ? 'tls' : 'tcp',
        client: `amqplib@${packageMetadata.dependencies.amqplib ?? 'unknown'}`,
        prefetch: 100,
      },
    },
  });
}

function imageVersion(image: string): string | null {
  const tag = image.includes('@') ? null : image.split(':').at(-1);
  return tag?.match(/\d+(?:\.\d+)+/)?.[0] ?? null;
}

function sanitizeImage(image: string): string {
  const segments = image.split('/');
  const registry = segments[0] ?? '';
  return segments.length > 1 &&
    (registry.includes('.') ||
      registry.includes(':') ||
      registry === 'localhost')
    ? segments.slice(1).join('/')
    : image;
}
