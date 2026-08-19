import type {
  ResolvedCreateSuiteRequest,
  Suite,
  SuiteConfiguration,
  SuiteError,
  EnvironmentSnapshot,
} from '@messaging-lab/shared';

import { ApiError } from '../errors.js';
import {
  SuiteRepository,
  type SuiteExecutionItem,
} from '../suite-repository.js';
import { RunEventStore } from './run-events.js';
import { RunManager } from './run-manager.js';
import { SuiteEventStore } from './suite-events.js';

interface ActiveSuite {
  readonly id: string;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
}

class SuiteCancelledError extends Error {
  public constructor() {
    super('The benchmark suite was cancelled.');
    this.name = 'SuiteCancelledError';
  }
}

class SuiteStoppedError extends Error {
  public constructor() {
    super('The API stopped before the suite reached a terminal state.');
    this.name = 'SuiteStoppedError';
  }
}

type Delay = (milliseconds: number, signal: AbortSignal) => Promise<void>;
type CaptureEnvironment = () => EnvironmentSnapshot;

export class SuiteScheduler {
  private activeSuite: ActiveSuite | null = null;

  public constructor(
    private readonly repository: SuiteRepository,
    private readonly runManager: RunManager,
    private readonly runEvents: RunEventStore,
    private readonly events: SuiteEventStore,
    private readonly captureEnvironment: CaptureEnvironment,
    private readonly random: () => number = Math.random,
    private readonly delay: Delay = abortableDelay,
  ) {}

  public start(request: ResolvedCreateSuiteRequest): Suite {
    if (this.activeSuite) {
      throw new ApiError(
        409,
        'SUITE_ALREADY_ACTIVE',
        `Suite ${this.activeSuite.id} is already active.`,
        { activeSuiteId: this.activeSuite.id },
      );
    }
    if (this.runManager.activeRunId) {
      throw new ApiError(
        409,
        'RUN_ALREADY_ACTIVE',
        `Run ${this.runManager.activeRunId} is already active.`,
        { activeRunId: this.runManager.activeRunId },
      );
    }

    const order = buildSuiteExecutionOrder(request.configuration, this.random);
    const suite = this.repository.create(
      request.name,
      request.configuration,
      order,
      this.captureEnvironment(),
      request.description,
    );
    const controller = new AbortController();
    const completion = Promise.resolve().then(() =>
      this.execute(suite.id, controller),
    );
    this.activeSuite = { id: suite.id, controller, completion };
    void completion.then(
      () => this.clearActiveSuite(suite.id),
      () => this.clearActiveSuite(suite.id),
    );
    this.events.publish(suite.id, { type: 'status', status: 'pending' });
    this.publishState(suite.id);
    return suite;
  }

  public cancel(suiteId: string): void {
    const suite = this.repository.getById(suiteId);
    if (!suite) {
      throw new ApiError(
        404,
        'SUITE_NOT_FOUND',
        `Suite ${suiteId} was not found.`,
      );
    }
    if (!this.activeSuite || this.activeSuite.id !== suiteId) {
      throw new ApiError(
        409,
        'SUITE_NOT_ACTIVE',
        `Suite ${suiteId} is not active.`,
      );
    }
    this.abortActiveSuite(new SuiteCancelledError());
  }

  public async waitForCompletion(suiteId: string): Promise<Suite> {
    const active = this.activeSuite;
    if (active?.id === suiteId) await active.completion;
    return this.repository.requireById(suiteId);
  }

  public async shutdown(): Promise<void> {
    if (!this.activeSuite) return;
    const completion = this.activeSuite.completion;
    this.abortActiveSuite(new SuiteStoppedError());
    await completion;
  }

  public get activeSuiteId(): string | null {
    return this.activeSuite?.id ?? null;
  }

  private abortActiveSuite(reason: Error): void {
    this.activeSuite?.controller.abort(reason);
    const activeRunId = this.runManager.activeRunId;
    if (activeRunId) {
      try {
        this.runManager.cancel(activeRunId);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'RUN_NOT_ACTIVE')) {
          throw error;
        }
      }
    }
  }

  private async execute(
    suiteId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      this.repository.updateStatus(suiteId, 'running');
      this.events.publish(suiteId, { type: 'status', status: 'running' });
      const initial = this.repository.requireById(suiteId);

      for (const item of initial.runs) {
        throwIfAborted(controller.signal);
        if (item.position > 0 && initial.configuration.cooldownMs > 0) {
          await this.delay(initial.configuration.cooldownMs, controller.signal);
        }
        throwIfAborted(controller.signal);

        const run = this.runManager.start({
          ...initial.configuration.workload,
          ...item.combination,
        });
        this.repository.attachRun(suiteId, item.position, run.id);
        const unsubscribe = this.runEvents.subscribe(run.id, (runEvent) =>
          this.events.publish(suiteId, { type: 'run-event', runEvent }),
        );
        for (const runEvent of this.runEvents.history(run.id)) {
          this.events.publish(suiteId, { type: 'run-event', runEvent });
        }
        this.publishState(suiteId);
        await this.runManager.waitForCompletion(run.id);
        unsubscribe();
        this.publishState(suiteId);
        throwIfAborted(controller.signal);
      }

      this.repository.updateStatus(suiteId, 'completed');
      this.publishState(suiteId);
      this.events.publish(suiteId, { type: 'status', status: 'completed' });
    } catch (error) {
      const reason = controller.signal.aborted
        ? controller.signal.reason
        : error;
      if (
        reason instanceof SuiteCancelledError ||
        reason instanceof SuiteStoppedError
      ) {
        const status =
          reason instanceof SuiteCancelledError ? 'cancelled' : 'stopped';
        this.repository.updateStatus(suiteId, status, reason.message);
        this.publishState(suiteId);
        this.events.publish(suiteId, { type: 'status', status });
        return;
      }

      let failure = error;
      const activeRunId = this.runManager.activeRunId;
      if (activeRunId) {
        try {
          this.runManager.cancel(activeRunId);
          await this.runManager.waitForCompletion(activeRunId);
        } catch (cleanupError) {
          if (
            !(
              cleanupError instanceof ApiError &&
              cleanupError.code === 'RUN_NOT_ACTIVE'
            )
          ) {
            failure = new Error(
              'Suite scheduling and active-run cleanup failed.',
              {
                cause: cleanupError,
              },
            );
          }
        }
      }

      const suiteError: SuiteError = {
        code: 'SUITE_FAILED',
        message: failure instanceof Error ? failure.message : String(failure),
        occurredAt: new Date().toISOString(),
      };
      this.repository.addError(suiteId, suiteError);
      this.events.publish(suiteId, { type: 'error', error: suiteError });
      this.repository.updateStatus(suiteId, 'failed', suiteError.message);
      this.publishState(suiteId);
      this.events.publish(suiteId, { type: 'status', status: 'failed' });
    }
  }

  private publishState(suiteId: string): void {
    const suite = this.repository.requireById(suiteId);
    this.events.publish(suiteId, {
      type: 'progress',
      progress: suite.progress,
    });
    this.events.publish(suiteId, {
      type: 'summary',
      summary: suite.summary,
    });
  }

  private clearActiveSuite(suiteId: string): void {
    if (this.activeSuite?.id === suiteId) this.activeSuite = null;
  }
}

export function buildSuiteExecutionOrder(
  configuration: SuiteConfiguration,
  random: () => number = Math.random,
): SuiteExecutionItem[] {
  const items: Omit<SuiteExecutionItem, 'position'>[] = [];
  const combinations = configuration.combinations;

  for (
    let repetition = 1;
    repetition <= configuration.repetitions;
    repetition++
  ) {
    const shift =
      configuration.orderStrategy === 'rotating'
        ? (repetition - 1) % combinations.length
        : 0;
    for (let offset = 0; offset < combinations.length; offset++) {
      const combinationIndex = (offset + shift) % combinations.length;
      const combination = combinations[combinationIndex];
      if (!combination) throw new Error('Suite combination is missing.');
      items.push({ combinationIndex, repetition, combination });
    }
  }

  if (configuration.orderStrategy === 'randomized') {
    for (let index = items.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      const current = items[index];
      const swap = items[swapIndex];
      if (!current || !swap) throw new Error('Invalid randomized suite order.');
      items[index] = swap;
      items[swapIndex] = current;
    }
  }

  return items.map((item, position) => ({ ...item, position }));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
