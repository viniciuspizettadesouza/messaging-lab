import type { BrokerDelivery, OutboundMessage } from '@messaging-lab/shared';

interface WireMessage {
  readonly id: string;
  readonly globalSequence: number;
  readonly producerId: string;
  readonly producerSequence: number;
  readonly orderingKey: string;
  readonly payloadBase64: string;
  readonly publishedAtNanoseconds: string;
}

export function encodeMessage(message: OutboundMessage): Buffer {
  const wireMessage: WireMessage = {
    id: message.id,
    globalSequence: message.globalSequence,
    producerId: message.producerId,
    producerSequence: message.producerSequence,
    orderingKey: message.orderingKey,
    payloadBase64: Buffer.from(message.payload).toString('base64'),
    publishedAtNanoseconds: message.publishedAtNanoseconds.toString(),
  };
  return Buffer.from(JSON.stringify(wireMessage));
}

export function decodeMessage(
  encoded: Buffer | string,
  consumerId: string,
  nativeOrderScope: string | null = null,
): BrokerDelivery {
  const value = JSON.parse(encoded.toString()) as Partial<WireMessage>;

  if (
    typeof value.id !== 'string' ||
    typeof value.globalSequence !== 'number' ||
    !Number.isInteger(value.globalSequence) ||
    typeof value.producerId !== 'string' ||
    typeof value.producerSequence !== 'number' ||
    !Number.isInteger(value.producerSequence) ||
    typeof value.orderingKey !== 'string' ||
    typeof value.payloadBase64 !== 'string' ||
    typeof value.publishedAtNanoseconds !== 'string'
  ) {
    throw new Error('Broker message does not match the wire contract.');
  }

  return {
    id: value.id,
    globalSequence: value.globalSequence,
    producerId: value.producerId,
    producerSequence: value.producerSequence,
    orderingKey: value.orderingKey,
    payload: Buffer.from(value.payloadBase64, 'base64'),
    publishedAtNanoseconds: BigInt(value.publishedAtNanoseconds),
    consumerId,
    nativeOrderScope,
  };
}
