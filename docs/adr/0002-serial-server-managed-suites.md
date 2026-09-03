# ADR 0002: Serial execution and server-managed suites

- Status: Accepted
- Date: 2026-09-03

## Context

Benchmark results are sensitive to CPU, memory, storage, broker, and client
contention. Running combinations concurrently on one development machine would
make order and resource competition part of the result while obscuring which
workload caused it. Browser-owned scheduling also makes execution depend on an
open tab, network continuity, and client state.

A suite needs repeatable order, cancellation, progress, and persisted partial
results. Process restart is a special boundary: continuing automatically could
combine trials measured under different code, broker, or host conditions.

## Decision

The API permits one active benchmark run. A server-managed suite reserves that
run lane from its first trial until its terminal state, including configured
cooldown periods.

Before starting the first trial, the API expands repetitions and any sweep,
applies the fixed, rotating, or randomized order strategy, and persists every
ordered position. Randomization occurs once; the stored order is the record of
what the suite will execute.

The scheduler starts one ordinary run through the existing run manager, waits
for its terminal state, persists it in the suite position, waits through an
abortable cooldown, and then starts the next position. An unsuccessful trial
remains visible and does not silently disappear from the order.

The browser creates, observes, cancels, and displays suites. Disconnecting or
reloading the browser does not stop server-owned work. Run and suite SSE streams
provide live progress and reconnect replay from bounded in-memory stores.

Cancellation aborts an active cooldown and requests cancellation of the active
run. Remaining positions stay visibly queued and the suite becomes cancelled.
During graceful API shutdown, active work is stopped. On startup, persisted
pending or running runs become failed and their active suite becomes stopped.
The scheduler does not resume that suite automatically.

## Consequences

- Default measurements avoid deliberate benchmark-to-benchmark contention.
- Fixed and persisted randomized order make experiment sequence inspectable;
  rotating order helps distribute first-position bias across repetitions.
- A suite survives browser disconnects but not API process restarts.
- Cooldown is part of suite scheduling and lane ownership, not measured run
  time.
- Concurrent load generation requires a future explicitly named experiment
  contract rather than an incidental scheduler change.
- The single-run conflict response remains the authority for standalone and
  suite-created work.

Serial execution reduces one source of noise but cannot eliminate background
host load, thermal effects, caching, or time trends. Repetitions, provenance,
and cautious interpretation remain necessary.

## Rejected alternatives

### Browser-owned queue

The original dashboard could start combinations sequentially from client
state. It was rejected because closing or reloading the tab interrupts
orchestration, reconnect behavior is fragile, and the intended order and
partial suite state are not a durable server record.

### Concurrent suite trials

Parallel execution could reduce wall-clock duration, but on the local
single-node stack it introduces uncontrolled competition across brokers and
the API process. That conflicts with the project's reproducibility goal and
would make common-host resource contention difficult to distinguish from
broker behavior.

### Automatic resume after API restart

Persisted order makes technical resumption possible, but a restart may also
change application code, runtime, broker state, container allocation, or host
load. Combining pre- and post-restart trials without an explicit boundary would
produce a misleading suite, so interrupted suites stop with a recorded reason.
