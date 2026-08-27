import { randomUUID } from 'node:crypto';

import {
  recoveryExperimentDefinitions,
  type BrokerAdapter,
  type BrokerDelivery,
  type BrokerRunResource,
  type CleanupReport,
  type RecoveryExperimentResult,
  type ResolvedRecoveryExperimentRequest,
} from '@messaging-lab/shared';

import { createDeterministicPayload } from '../benchmark/payload.js';

export type RecoveryAdapterRegistry = Record<
  'redis' | 'kafka' | 'rabbitmq',
  BrokerAdapter
>;

export class RecoveryExperimentEngine {
  public constructor(private readonly adapters: RecoveryAdapterRegistry) {}

  public async execute(
    request: ResolvedRecoveryExperimentRequest,
    externalSignal?: AbortSignal,
  ): Promise<RecoveryExperimentResult> {
    const id = randomUUID();
    const definition = recoveryExperimentDefinitions[request.type];
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new RecoveryTimedOutError()),
      request.timeoutMs,
    );
    const abortFromExternal = () =>
      controller.abort(externalSignal?.reason ?? new RecoveryCancelledError());
    externalSignal?.addEventListener('abort', abortFromExternal, {
      once: true,
    });
    if (externalSignal?.aborted) abortFromExternal();

    let resource: BrokerRunResource | undefined;
    let creation: Promise<BrokerRunResource> | undefined;
    let cleanup: CleanupReport = emptyCleanupReport();
    const deliveries: BrokerDelivery[] = [];
    const errors: string[] = [];
    let recoveryTimeMs: number | null = null;

    try {
      creation = this.adapters[definition.broker].createRun({
        runId: id,
        scenario: definition.scenario,
        consumerCount: 1,
        signal: controller.signal,
      });
      resource = await raceWithSignal(creation, controller.signal);
      const recoveryStarted = process.hrtime.bigint();

      if (request.type === 'redis-pubsub-offline-loss') {
        for (let index = 0; index < request.messageCount; index += 1) {
          await publish(resource, index, controller.signal);
        }
        await resource.startConsumers((delivery) => {
          deliveries.push(delivery);
        });
        const probeReceived = waitFor(
          () => deliveries.some(({ id }) => id === 'online-probe'),
          controller.signal,
        );
        await raceWithSignal(
          resource.publish(message('online-probe', request.messageCount)),
          controller.signal,
        );
        await probeReceived;
        recoveryTimeMs = elapsedMilliseconds(recoveryStarted);
      } else if (isReplayExperiment(request.type)) {
        for (let index = 0; index < request.messageCount; index += 1) {
          await publish(resource, index, controller.signal);
        }
        const replay =
          request.type === 'kafka-offset-reset-replay'
            ? resource.resetReplay
            : resource.replay;
        if (!replay) {
          throw new Error(
            `${definition.label} is not implemented by this adapter.`,
          );
        }
        await raceWithSignal(
          replay.call(resource, (delivery) => {
            deliveries.push(delivery);
          }),
          controller.signal,
        );
        recoveryTimeMs = elapsedMilliseconds(recoveryStarted);
      } else {
        for (let index = 0; index < request.messageCount; index += 1) {
          if (index === request.interruptAfterMessages - 1) {
            if (!resource.demonstrateRecovery) {
              throw new Error(
                `${definition.label} is not implemented by this adapter.`,
              );
            }
            const interruptedAt = process.hrtime.bigint();
            await raceWithSignal(
              resource.demonstrateRecovery(
                message(`message-${index}`, index),
                (delivery) => {
                  deliveries.push(delivery);
                },
              ),
              controller.signal,
            );
            recoveryTimeMs = elapsedMilliseconds(interruptedAt);
          } else {
            await publish(resource, index, controller.signal);
          }
        }
        const interruptedId = `message-${request.interruptAfterMessages - 1}`;
        await resource.startConsumers((delivery) => {
          if (delivery.id !== interruptedId) deliveries.push(delivery);
        });
        await waitFor(
          () =>
            new Set(
              deliveries
                .filter(({ id }) => id.startsWith('message-'))
                .map(({ id }) => id),
            ).size >= request.messageCount,
          controller.signal,
        );
      }
    } catch (error) {
      errors.push(errorMessage(error));
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
      if (!resource && creation) {
        void creation
          .then((lateResource) => lateResource.cleanup())
          .catch(() => undefined);
      }
      if (resource) {
        try {
          cleanup = await resource.cleanup();
        } catch (error) {
          cleanup = {
            attemptedResources: resource.resourceNames.length,
            removedResources: 0,
            failures: [
              { resource: 'recovery experiment', message: errorMessage(error) },
            ],
          };
        }
      }
      errors.push(
        ...cleanup.failures.map(
          ({ resource, message }) => `${resource}: ${message}`,
        ),
      );
    }

    const deliveredIds = deliveries
      .filter(({ id }) => id.startsWith('message-'))
      .map(({ id }) => id);
    const uniqueDeliveries = new Set(deliveredIds).size;
    const replayAttempted = isReplayExperiment(request.type);
    const recoveryExperiment = isRecoveryExperiment(request.type);
    const receivedMessages =
      request.type === 'redis-pubsub-offline-loss' ? 0 : deliveredIds.length;
    const lostMessages = Math.max(0, request.messageCount - uniqueDeliveries);
    const observedBehavior = describeObservation(
      request.type,
      request.messageCount,
      uniqueDeliveries,
      errors,
    );

    return {
      id,
      type: request.type,
      broker: definition.broker,
      scenario: definition.scenario,
      status: statusFor(errors, controller.signal.reason),
      deterministicInterruption: {
        afterMessages: request.interruptAfterMessages,
      },
      replay: {
        supported: definition.replaySupported,
        attempted: replayAttempted,
        explanation: definition.replaySupported
          ? replayAttempted
            ? 'Replay was requested through the broker-native retained-message mechanism.'
            : 'Replay is supported by this broker, but this experiment exercised consumer recovery.'
          : 'This broker mechanism does not retain acknowledged or offline messages for arbitrary replay.',
      },
      expectedBehavior: definition.expectedBehavior,
      observedBehavior,
      observations: {
        recoveryTimeMs,
        publishedMessages: request.messageCount,
        receivedMessages,
        redeliveredMessages:
          recoveryExperiment &&
          deliveredIds.includes(`message-${request.interruptAfterMessages - 1}`)
            ? 1
            : 0,
        duplicateMessages: deliveredIds.length - uniqueDeliveries,
        lostMessages,
        errorCount: errors.length,
      },
      resourceCleanup: {
        attemptedResources: cleanup.attemptedResources,
        removedResources: cleanup.removedResources,
        failures: cleanup.failures.map((failure) => ({ ...failure })),
      },
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

function message(id: string, seed: number) {
  return {
    id,
    payload: createDeterministicPayload(64, seed),
    publishedAtNanoseconds: process.hrtime.bigint(),
  };
}

async function publish(
  resource: BrokerRunResource,
  index: number,
  signal: AbortSignal,
): Promise<void> {
  await raceWithSignal(
    resource.publish(message(`message-${index}`, index)),
    signal,
  );
}

function waitFor(predicate: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearInterval(timer);
      reject(signal.reason);
    };
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        signal.removeEventListener('abort', abort);
        resolve();
      }
    }, 5);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function isReplayExperiment(type: string): boolean {
  return type.endsWith('replay');
}

function isRecoveryExperiment(type: string): boolean {
  return type.endsWith('recovery') || type.endsWith('redelivery');
}

function describeObservation(
  type: string,
  messageCount: number,
  received: number,
  errors: readonly string[],
): string {
  if (errors.length > 0) return `The experiment failed: ${errors[0]}`;
  if (type === 'redis-pubsub-offline-loss') {
    return `${messageCount} messages published without a subscriber were unavailable after connection; an online probe was delivered.`;
  }
  if (isReplayExperiment(type)) {
    return `${received} of ${messageCount} retained messages were replayed.`;
  }
  return `${received} interrupted message was delivered to the replacement consumer.`;
}

function statusFor(
  errors: readonly string[],
  abortReason: unknown,
): RecoveryExperimentResult['status'] {
  if (abortReason instanceof RecoveryTimedOutError) return 'timed-out';
  if (abortReason) return 'cancelled';
  return errors.length === 0 ? 'completed' : 'failed';
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyCleanupReport(): CleanupReport {
  return { attemptedResources: 0, removedResources: 0, failures: [] };
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

class RecoveryTimedOutError extends Error {
  public constructor() {
    super('The recovery experiment timed out.');
  }
}

class RecoveryCancelledError extends Error {
  public constructor() {
    super('The recovery experiment was cancelled.');
  }
}
