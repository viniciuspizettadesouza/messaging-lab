import type { BrokerHealth } from './api.js';
import type { BrokerCapabilities, BrokerId, ScenarioId } from './domain.js';

export interface OutboundMessage {
  readonly id: string;
  readonly globalSequence: number;
  readonly producerId: string;
  readonly producerSequence: number;
  readonly orderingKey: string;
  readonly payload: Uint8Array;
  readonly publishedAtNanoseconds: bigint;
}

export interface BrokerDelivery extends OutboundMessage {
  readonly consumerId: string;
  /** Broker-native scope in which delivery order has a defined meaning. */
  readonly nativeOrderScope: string | null;
}

export type DeliveryHandler = (
  delivery: BrokerDelivery,
) => void | Promise<void>;

export interface BrokerRunContext {
  readonly runId: string;
  readonly scenario: ScenarioId;
  readonly consumerCount: number;
  readonly signal: AbortSignal;
}

export interface CleanupFailure {
  readonly resource: string;
  readonly message: string;
}

export interface CleanupReport {
  readonly attemptedResources: number;
  readonly removedResources: number;
  readonly failures: readonly CleanupFailure[];
}

/** Cleanup must be safe to call more than once, including after partial setup. */
export interface BrokerRunResource {
  readonly resourceNames: readonly string[];
  startConsumers(onDelivery: DeliveryHandler): Promise<void>;
  publish(message: OutboundMessage): Promise<void>;
  replay?(onDelivery: DeliveryHandler): Promise<void>;
  /** Kafka uses this hook to make the offset reset explicit. */
  resetReplay?(onDelivery: DeliveryHandler): Promise<void>;
  demonstrateRecovery?(
    message: OutboundMessage,
    onDelivery: DeliveryHandler,
  ): Promise<void>;
  cleanup(): Promise<CleanupReport>;
}

export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly capabilities: BrokerCapabilities;
  checkHealth(signal?: AbortSignal): Promise<BrokerHealth>;
  createRun(context: BrokerRunContext): Promise<BrokerRunResource>;
}
