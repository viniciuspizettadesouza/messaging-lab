import type { BrokerDelivery, OutboundMessage } from '@messaging-lab/shared';

interface WireMessage {
  readonly id: string;
  readonly payloadBase64: string;
  readonly publishedAtNanoseconds: string;
}

export function encodeMessage(message: OutboundMessage): Buffer {
  const wireMessage: WireMessage = {
    id: message.id,
    payloadBase64: Buffer.from(message.payload).toString('base64'),
    publishedAtNanoseconds: message.publishedAtNanoseconds.toString(),
  };
  return Buffer.from(JSON.stringify(wireMessage));
}

export function decodeMessage(
  encoded: Buffer | string,
  consumerId: string,
): BrokerDelivery {
  const value = JSON.parse(encoded.toString()) as Partial<WireMessage>;

  if (
    typeof value.id !== 'string' ||
    typeof value.payloadBase64 !== 'string' ||
    typeof value.publishedAtNanoseconds !== 'string'
  ) {
    throw new Error('Broker message does not match the wire contract.');
  }

  return {
    id: value.id,
    payload: Buffer.from(value.payloadBase64, 'base64'),
    publishedAtNanoseconds: BigInt(value.publishedAtNanoseconds),
    consumerId,
  };
}
