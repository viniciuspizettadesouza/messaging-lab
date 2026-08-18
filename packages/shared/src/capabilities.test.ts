import { describe, expect, it } from 'vitest';

import { BROKER_CAPABILITIES } from './capabilities.js';
import { brokerCapabilitiesSchema, BROKER_IDS } from './domain.js';

describe('BROKER_CAPABILITIES', () => {
  it('provides a complete, valid mapping for every broker', () => {
    expect(Object.keys(BROKER_CAPABILITIES)).toEqual(BROKER_IDS);

    for (const capabilities of Object.values(BROKER_CAPABILITIES)) {
      expect(brokerCapabilitiesSchema.safeParse(capabilities).success).toBe(
        true,
      );
    }
  });

  it('makes unsupported semantics explicit', () => {
    expect(BROKER_CAPABILITIES.redis['fan-out']).toMatchObject({
      persistence: false,
      acknowledgements: false,
      consumerRecovery: false,
      replay: false,
    });
    expect(BROKER_CAPABILITIES.rabbitmq['competing-consumers'].replay).toBe(
      false,
    );
  });

  it('captures the native Redis Streams and Kafka capabilities', () => {
    expect(BROKER_CAPABILITIES.redis['competing-consumers'].replay).toBe(true);
    expect(BROKER_CAPABILITIES.kafka['fan-out'].replay).toBe(true);
  });
});
