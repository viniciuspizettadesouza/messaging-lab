export function createDeterministicPayload(
  size: number,
  seed: number,
): Uint8Array {
  const payload = new Uint8Array(size);

  for (let index = 0; index < size; index += 1) {
    payload[index] = (index + seed) % 251;
  }

  return payload;
}

export function warmupMessageCount(messageCount: number): number {
  return Math.min(100, Math.max(1, Math.ceil(messageCount * 0.01)));
}
