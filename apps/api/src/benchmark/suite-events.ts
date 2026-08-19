import {
  suiteEventSchema,
  type RunEvent,
  type SuiteError,
  type SuiteEvent,
  type SuiteProgress,
  type SuiteStatus,
  type SuiteSummary,
} from '@messaging-lab/shared';

export type SuiteEventInput =
  | { readonly type: 'status'; readonly status: SuiteStatus }
  | { readonly type: 'progress'; readonly progress: SuiteProgress }
  | { readonly type: 'run-event'; readonly runEvent: RunEvent }
  | { readonly type: 'summary'; readonly summary: SuiteSummary }
  | { readonly type: 'error'; readonly error: SuiteError }
  | { readonly type: 'heartbeat' };

type SuiteEventListener = (event: SuiteEvent) => void;

interface SuiteEventState {
  readonly events: SuiteEvent[];
  readonly listeners: Set<SuiteEventListener>;
  nextSequence: number;
}

export class SuiteEventStore {
  private readonly suites = new Map<string, SuiteEventState>();

  public constructor(private readonly historyLimit = 1_000) {}

  public publish(suiteId: string, input: SuiteEventInput): SuiteEvent {
    const state = this.getState(suiteId);
    const event = suiteEventSchema.parse({
      suiteId,
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

  public history(suiteId: string): readonly SuiteEvent[] {
    return [...(this.suites.get(suiteId)?.events ?? [])];
  }

  public subscribe(suiteId: string, listener: SuiteEventListener): () => void {
    const state = this.getState(suiteId);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  private getState(suiteId: string): SuiteEventState {
    let state = this.suites.get(suiteId);
    if (!state) {
      state = { events: [], listeners: new Set(), nextSequence: 0 };
      this.suites.set(suiteId, state);
    }
    return state;
  }
}
