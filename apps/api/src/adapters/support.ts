import type { CleanupFailure, CleanupReport } from '@messaging-lab/shared';

export interface CleanupTask {
  readonly resource: string;
  readonly cleanup: () => void | Promise<void>;
}

export async function runCleanup(
  tasks: readonly CleanupTask[],
): Promise<CleanupReport> {
  const failures: CleanupFailure[] = [];
  let removedResources = 0;

  for (const task of tasks) {
    try {
      await task.cleanup();
      removedResources += 1;
    } catch (error) {
      failures.push({
        resource: task.resource,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attemptedResources: tasks.length,
    removedResources,
    failures,
  };
}

export function resourceSuffix(runId: string): string {
  const suffix = runId.toLowerCase().replaceAll(/[^a-z0-9]/g, '');

  if (suffix.length === 0) {
    throw new Error('Run ID must contain at least one alphanumeric character.');
  }

  return suffix.slice(0, 48);
}

export async function elapsedHealthCheck(
  operation: () => Promise<void>,
): Promise<{
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  checkedAt: string;
  error: string | null;
}> {
  const startedAt = performance.now();

  try {
    await operation();
    return {
      status: 'healthy',
      latencyMs: performance.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: performance.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: errorMessage(error),
    };
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map(errorMessage).filter(Boolean);
    return messages.join('; ') || error.message || 'Multiple errors occurred.';
  }
  return error instanceof Error ? error.message : String(error);
}
