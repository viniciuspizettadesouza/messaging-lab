import {
  runEventSchema,
  type BenchmarkMetrics,
  type RunError,
  type RunEvent,
  type RunPhase,
  type RunStatus,
} from '@messaging-lab/shared';

type RunEventInput =
  | { readonly type: 'status'; readonly status: RunStatus }
  | {
      readonly type: 'progress';
      readonly phase: RunPhase;
      readonly completedUnits: number;
      readonly totalUnits: number;
      readonly publishedMessages: number;
      readonly receivedMessages: number;
    }
  | { readonly type: 'metrics'; readonly metrics: BenchmarkMetrics }
  | { readonly type: 'error'; readonly error: RunError }
  | { readonly type: 'heartbeat' };

type RunEventListener = (event: RunEvent) => void;

interface RunEventState {
  readonly events: RunEvent[];
  readonly listeners: Set<RunEventListener>;
  nextSequence: number;
}

export class RunEventStore {
  private readonly runs = new Map<string, RunEventState>();

  public constructor(private readonly historyLimit = 500) {}

  public publish(runId: string, input: RunEventInput): RunEvent {
    const state = this.getState(runId);
    const event = runEventSchema.parse({
      runId,
      sequence: state.nextSequence,
      timestamp: new Date().toISOString(),
      ...input,
    });
    state.nextSequence += 1;
    state.events.push(event);
    if (state.events.length > this.historyLimit) state.events.shift();

    for (const listener of state.listeners) listener(event);
    return event;
  }

  public history(runId: string): readonly RunEvent[] {
    return [...(this.runs.get(runId)?.events ?? [])];
  }

  public subscribe(runId: string, listener: RunEventListener): () => void {
    const state = this.getState(runId);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  private getState(runId: string): RunEventState {
    let state = this.runs.get(runId);
    if (!state) {
      state = { events: [], listeners: new Set(), nextSequence: 0 };
      this.runs.set(runId, state);
    }
    return state;
  }
}

export function formatSseEvent(event: RunEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
