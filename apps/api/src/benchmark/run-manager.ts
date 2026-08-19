import type {
  BrokerAdapter,
  BrokerId,
  ResolvedStartRunRequest,
  Run,
  RunError,
  RunStatus,
} from '@messaging-lab/shared';

import { ApiError } from '../errors.js';
import { RunRepository } from '../run-repository.js';
import {
  BenchmarkEngine,
  BenchmarkExecutionError,
  type BenchmarkProgress,
} from './benchmark-engine.js';
import { RunEventStore } from './run-events.js';

export type BrokerAdapterRegistry = Record<BrokerId, BrokerAdapter>;

interface ActiveRun {
  readonly id: string;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
}

class RunCancelledError extends Error {
  public constructor() {
    super('The benchmark run was cancelled.');
    this.name = 'RunCancelledError';
  }
}

class RunTimedOutError extends Error {
  public constructor(timeoutMs: number) {
    super(`The benchmark run exceeded its ${timeoutMs} ms timeout.`);
    this.name = 'RunTimedOutError';
  }
}

export class RunManager {
  private activeRun: ActiveRun | null = null;

  public constructor(
    private readonly repository: RunRepository,
    private readonly adapters: BrokerAdapterRegistry,
    private readonly events: RunEventStore,
    private readonly engine = new BenchmarkEngine(),
  ) {}

  public start(configuration: ResolvedStartRunRequest): Run {
    if (this.activeRun) {
      throw new ApiError(
        409,
        'RUN_ALREADY_ACTIVE',
        `Run ${this.activeRun.id} is already active.`,
        { activeRunId: this.activeRun.id },
      );
    }

    let run = this.repository.create(configuration);
    for (const note of this.adapters[configuration.broker].capabilities[
      configuration.scenario
    ].notes) {
      run = this.repository.addNote(run.id, note);
    }

    const controller = new AbortController();
    const completion = Promise.resolve().then(() =>
      this.executeRun(run.id, configuration, controller),
    );
    this.activeRun = { id: run.id, controller, completion };
    void completion.then(
      () => this.clearActiveRun(run.id),
      () => this.clearActiveRun(run.id),
    );
    this.events.publish(run.id, { type: 'status', status: 'pending' });
    return run;
  }

  public cancel(runId: string): void {
    const run = this.repository.getById(runId);
    if (!run)
      throw new ApiError(404, 'RUN_NOT_FOUND', `Run ${runId} was not found.`);
    if (!this.activeRun || this.activeRun.id !== runId) {
      throw new ApiError(409, 'RUN_NOT_ACTIVE', `Run ${runId} is not active.`);
    }
    this.activeRun.controller.abort(new RunCancelledError());
  }

  public async waitForCompletion(runId: string): Promise<Run> {
    const active = this.activeRun;
    if (!active || active.id !== runId) {
      const run = this.repository.getById(runId);
      if (run && isTerminal(run.status)) return run;
      throw new Error(`Run ${runId} is not active or terminal.`);
    }
    await active.completion;
    return this.repository.requireById(runId);
  }

  public async shutdown(): Promise<void> {
    if (!this.activeRun) return;
    this.activeRun.controller.abort(new RunCancelledError());
    await this.activeRun.completion;
  }

  public get activeRunId(): string | null {
    return this.activeRun?.id ?? null;
  }

  private clearActiveRun(runId: string): void {
    if (this.activeRun?.id === runId) this.activeRun = null;
  }

  private async executeRun(
    runId: string,
    configuration: ResolvedStartRunRequest,
    controller: AbortController,
  ): Promise<void> {
    const timeout = setTimeout(
      () => controller.abort(new RunTimedOutError(configuration.timeoutMs)),
      configuration.timeoutMs,
    );

    try {
      this.repository.updateStatus(runId, 'running');
      this.events.publish(runId, { type: 'status', status: 'running' });
      const reportProgress = createProgressReporter(runId, this.events);
      const metrics = await this.engine.execute({
        runId,
        configuration,
        adapter: this.adapters[configuration.broker],
        signal: controller.signal,
        onProgress: reportProgress,
      });
      this.repository.saveMetrics(runId, metrics);
      this.events.publish(runId, { type: 'metrics', metrics });
      this.repository.updateStatus(runId, 'completed');
      this.events.publish(runId, { type: 'status', status: 'completed' });
    } catch (error) {
      const executionError =
        error instanceof BenchmarkExecutionError ? error : undefined;
      const cause = executionError?.cause ?? error;
      const status = terminalStatus(cause);

      if (executionError?.metrics) {
        this.repository.saveMetrics(runId, executionError.metrics);
        this.events.publish(runId, {
          type: 'metrics',
          metrics: executionError.metrics,
        });
      }

      const runError = createRunError(cause, status);
      this.repository.addError(runId, runError);
      this.events.publish(runId, { type: 'error', error: runError });

      for (const failure of executionError?.cleanupReport.failures ?? []) {
        const cleanupError: RunError = {
          code: 'CLEANUP_FAILED',
          message: `Failed to clean up ${failure.resource}: ${failure.message}`,
          occurredAt: new Date().toISOString(),
          details: { resource: failure.resource },
        };
        this.repository.addError(runId, cleanupError);
        this.events.publish(runId, { type: 'error', error: cleanupError });
      }

      this.repository.updateStatus(runId, status);
      this.events.publish(runId, { type: 'status', status });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function terminalStatus(error: unknown): RunStatus {
  if (error instanceof RunCancelledError) return 'cancelled';
  if (error instanceof RunTimedOutError) return 'timed-out';
  return 'failed';
}

function isTerminal(status: RunStatus): boolean {
  return ['completed', 'failed', 'timed-out', 'cancelled'].includes(status);
}

function createRunError(error: unknown, status: RunStatus): RunError {
  const code =
    status === 'cancelled'
      ? 'RUN_CANCELLED'
      : status === 'timed-out'
        ? 'RUN_TIMED_OUT'
        : 'RUN_FAILED';
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    occurredAt: new Date().toISOString(),
  };
}

function createProgressReporter(runId: string, events: RunEventStore) {
  const lastCompleted = new Map<string, number>();

  return (progress: BenchmarkProgress) => {
    const previous = lastCompleted.get(progress.phase) ?? -1;
    const interval = Math.max(1, Math.ceil(progress.totalUnits / 100));
    const shouldPublish =
      progress.completedUnits === 0 ||
      progress.completedUnits === progress.totalUnits ||
      progress.completedUnits - previous >= interval;

    if (!shouldPublish) return;
    lastCompleted.set(progress.phase, progress.completedUnits);
    events.publish(runId, { type: 'progress', ...progress });
  };
}
