import type { BrokerCapabilities, BrokerId } from './domain.js';

export const BROKER_CAPABILITIES = {
  redis: {
    'fan-out': {
      supported: true,
      persistence: false,
      acknowledgements: false,
      consumerRecovery: false,
      replay: false,
      notes: ['Redis Pub/Sub delivers only to subscribers that are connected.'],
    },
    'competing-consumers': {
      supported: true,
      persistence: true,
      acknowledgements: true,
      consumerRecovery: true,
      replay: true,
      notes: ['Redis Streams uses a consumer group for competing consumers.'],
    },
  },
  kafka: {
    'fan-out': {
      supported: true,
      persistence: true,
      acknowledgements: true,
      consumerRecovery: true,
      replay: true,
      notes: ['Each fan-out subscriber uses a separate consumer group.'],
    },
    'competing-consumers': {
      supported: true,
      persistence: true,
      acknowledgements: true,
      consumerRecovery: true,
      replay: true,
      notes: ['Consumers share partitions within one consumer group.'],
    },
  },
  rabbitmq: {
    'fan-out': {
      supported: true,
      persistence: true,
      acknowledgements: true,
      consumerRecovery: true,
      replay: false,
      notes: ['A fanout exchange routes messages to one queue per subscriber.'],
    },
    'competing-consumers': {
      supported: true,
      persistence: true,
      acknowledgements: true,
      consumerRecovery: true,
      replay: false,
      notes: [
        'Consumers share one queue; arbitrary retained-log replay is unavailable.',
      ],
    },
  },
} as const satisfies Record<BrokerId, BrokerCapabilities>;
