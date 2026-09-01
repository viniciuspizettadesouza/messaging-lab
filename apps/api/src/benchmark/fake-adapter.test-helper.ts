import {
  BROKER_CAPABILITIES,
  type BrokerAdapter,
  type BrokerDelivery,
  type BrokerRunContext,
  type BrokerRunResource,
  type DeliveryHandler,
  type OutboundMessage,
} from '@messaging-lab/shared';

export class ImmediateAdapter implements BrokerAdapter {
  public readonly id = 'redis' as const;
  public readonly capabilities = BROKER_CAPABILITIES.redis;
  public cleaned = false;
  public readonly publishedPayloadSizes: number[] = [];

  public constructor(
    private readonly duplicate = false,
    private readonly deliveryDelayMs: (
      message: OutboundMessage,
    ) => number = () => 0,
  ) {}

  public async checkHealth() {
    return {
      status: 'healthy' as const,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  public async createRun(
    context: BrokerRunContext,
  ): Promise<BrokerRunResource> {
    let handler: DeliveryHandler | undefined;
    const published: OutboundMessage[] = [];
    const deliver = async (message: OutboundMessage) => {
      if (!handler) return;
      const delayMs = this.deliveryDelayMs(message);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const deliveries =
        context.scenario === 'fan-out'
          ? Array.from({ length: context.consumerCount }, (_, index) =>
              delivery(message, `consumer-${index + 1}`),
            )
          : [delivery(message, 'consumer-1')];
      for (const value of deliveries) await handler(value);
      if (this.duplicate) await handler(deliveries[0]!);
    };
    return {
      resourceNames: ['fake-resource'],
      startConsumers: async (onDelivery) => {
        handler = onDelivery;
        for (const message of published) await deliver(message);
      },
      publish: async (message) => {
        this.publishedPayloadSizes.push(message.payload.byteLength);
        published.push(message);
        await deliver(message);
      },
      replay: async (onDelivery) => {
        for (const message of published) {
          await onDelivery(delivery(message, 'replay-consumer'));
        }
      },
      resetReplay: async (onDelivery) => {
        for (const message of published) {
          await onDelivery(delivery(message, 'offset-reset-consumer'));
        }
      },
      demonstrateRecovery: async (message, onDelivery) => {
        await onDelivery(delivery(message, 'recovered-consumer'));
      },
      cleanup: async () => {
        this.cleaned = true;
        return { attemptedResources: 1, removedResources: 1, failures: [] };
      },
    };
  }
}

function delivery(
  message: OutboundMessage,
  consumerId: string,
): BrokerDelivery {
  return { ...message, consumerId, nativeOrderScope: 'fake:scope' };
}
