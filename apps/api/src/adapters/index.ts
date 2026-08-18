import type { BrokerAdapter, BrokerId } from '@messaging-lab/shared';

import type { ApiConfig } from '../config.js';
import { KafkaAdapter } from './kafka-adapter.js';
import { RabbitMqAdapter } from './rabbitmq-adapter.js';
import { RedisAdapter } from './redis-adapter.js';

export type BrokerAdapterRegistry = Record<BrokerId, BrokerAdapter>;

export function createBrokerAdapters(config: ApiConfig): BrokerAdapterRegistry {
  return {
    redis: new RedisAdapter(config.redisUrl),
    kafka: new KafkaAdapter(config.kafkaBrokers),
    rabbitmq: new RabbitMqAdapter(config.rabbitMqUrl),
  };
}
