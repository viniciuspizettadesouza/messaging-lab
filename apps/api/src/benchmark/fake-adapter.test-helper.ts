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

  public constructor(private readonly duplicate = false) {}

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
    return {
      resourceNames: ['fake-resource'],
      startConsumers: async (onDelivery) => {
        handler = onDelivery;
      },
      publish: async (message) => {
        this.publishedPayloadSizes.push(message.payload.byteLength);
        if (!handler) throw new Error('Consumers have not started.');
        const deliveries =
          context.scenario === 'fan-out'
            ? Array.from({ length: context.consumerCount }, (_, index) =>
                delivery(message, `consumer-${index + 1}`),
              )
            : [delivery(message, 'consumer-1')];
        for (const value of deliveries) await handler(value);
        if (this.duplicate) await handler(deliveries[0]!);
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
  return { ...message, consumerId };
}
