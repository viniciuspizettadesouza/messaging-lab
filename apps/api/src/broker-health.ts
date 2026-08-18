import { Socket } from 'node:net';

import {
  BROKER_IDS,
  type BrokerHealth,
  type BrokerId,
} from '@messaging-lab/shared';

import type { ApiConfig } from './config.js';

interface BrokerAddress {
  readonly host: string;
  readonly port: number;
}

export type BrokerHealthChecker = (broker: BrokerId) => Promise<BrokerHealth>;

export function createBrokerHealthChecker(
  config: ApiConfig,
  timeoutMs = 1_000,
): BrokerHealthChecker {
  const addresses: Record<BrokerId, BrokerAddress> = {
    redis: addressFromUrl(config.redisUrl, 6_379),
    kafka: addressFromBroker(config.kafkaBrokers[0]!),
    rabbitmq: addressFromUrl(config.rabbitMqUrl, 5_672),
  };

  return async (broker) => probeTcp(addresses[broker], timeoutMs);
}

export async function checkAllBrokerHealth(
  checker: BrokerHealthChecker,
): Promise<Record<BrokerId, BrokerHealth>> {
  const entries = await Promise.all(
    BROKER_IDS.map(async (broker) => [broker, await checker(broker)] as const),
  );
  return Object.fromEntries(entries) as Record<BrokerId, BrokerHealth>;
}

function addressFromUrl(value: string, defaultPort: number): BrokerAddress {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : defaultPort,
  };
}

function addressFromBroker(value: string): BrokerAddress {
  const url = new URL(`tcp://${value}`);

  if (!url.port) {
    throw new Error(`Kafka broker address must include a port: ${value}`);
  }

  return { host: url.hostname, port: Number.parseInt(url.port, 10) };
}

function probeTcp(
  address: BrokerAddress,
  timeoutMs: number,
): Promise<BrokerHealth> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (status: BrokerHealth['status'], error: string | null) => {
      if (settled) return;
      settled = true;
      const latencyMs = performance.now() - startedAt;
      socket.destroy();
      resolve({
        status,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('healthy', null));
    socket.once('timeout', () => finish('unhealthy', 'Connection timed out.'));
    socket.once('error', (error) => finish('unhealthy', error.message));
    socket.connect(address.port, address.host);
  });
}
