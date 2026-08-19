# Messaging Lab — Product and Engineering Plan

## Project status

Messaging Lab has a complete local-first MVP. It can run live fan-out and competing-consumer workloads against Redis, Kafka, and RabbitMQ; stream progress; persist results in SQLite; and explain the semantic differences between the brokers.

The next phase turns the project from a collection of individual benchmark runs into a reproducible experimentation environment. The priorities are repeatability, correctness, failure behavior, and clear interpretation—not producing a universal broker ranking.

## Product principles

- Compare only workloads with sufficiently similar delivery semantics.
- Keep Redis Pub/Sub separate as an ephemeral live-delivery baseline.
- Prefer repeated measurements and distributions over single-run conclusions.
- Record enough environment and configuration data to reproduce a result.
- Treat message loss, duplicates, ordering, recovery, and replay as first-class outcomes.
- Run benchmarks serially by default to reduce local resource contention.
- Make unsupported behavior explicit instead of simulating equivalence.
- Keep the application, code identifiers, and public documentation in English.

## Phase 2 goals

1. Make benchmark suites persistent and independent of the browser.
2. Support repeated trials and statistically useful summaries.
3. Add parameter sweeps for consumers, producers, payload size, and message count.
4. Add controlled recovery, replay, ordering, and backpressure experiments.
5. Improve result discovery, filtering, comparison, and export.
6. Reduce orchestration complexity in the frontend and preserve runtime validation as contracts expand.
7. Expand end-to-end testing, accessibility, operational documentation, and contributor guidance.

## Architecture evolution

### Persistent benchmark suites

A suite is a server-managed collection of runs. It owns the execution order and continues even if the dashboard disconnects or reloads.

The suite model should include:

- A unique suite identifier, name, status, and timestamps.
- A normalized workload configuration shared by its runs.
- The broker/scenario combinations included in the suite.
- The repetition count, execution order strategy, and cooldown duration.
- Ordered run references with combination and repetition indexes.
- Progress, stop reason, and aggregate summary.
- An environment snapshot captured when the suite starts.

The API remains responsible for enforcing one active benchmark run. A suite scheduler starts the next run only after the current run reaches a terminal state and the configured cooldown has elapsed.

Initial order strategies:

- `fixed`: deterministic order for debugging.
- `rotating`: shift the first broker between repetitions to reduce order bias.
- `randomized`: persist a generated order so the suite remains reproducible.

### Suite API

Add typed shared contracts and endpoints for:

- `POST /api/suites` — validate, persist, and start a suite.
- `GET /api/suites` — list suites with lightweight filters.
- `GET /api/suites/:id` — return configuration, ordered runs, and summaries.
- `GET /api/suites/:id/events` — stream suite and active-run progress over SSE.
- `POST /api/suites/:id/cancel` — stop queued work and cancel the active run.

Existing run endpoints remain available for individual experiments and run details.

### Persistence

Extend SQLite with versioned migrations and tables for:

- Suites and their lifecycle state.
- Ordered suite-run membership.
- Environment snapshots.
- Aggregate suite summaries when caching them is useful.

Suite recovery on API startup must be explicit. An interrupted active run becomes failed, while its suite becomes stopped with a recorded reason. Automatic continuation after process restart is out of scope initially because it could produce misleading results under changed host conditions.

### Frontend orchestration

Move suite scheduling out of `App` and into the API. The frontend should only create, observe, cancel, and display suites.

Split application behavior into focused hooks or controllers:

- Initial dashboard loading and refresh.
- Individual run lifecycle and SSE subscription.
- Suite lifecycle and progress subscription.
- Run and suite selection.

Keep result grouping and statistical summaries in pure functions so they can be tested without rendering React components.

### Runtime contract validation

The current API client validates successful responses and SSE events with the
shared Zod schemas. New suite, sweep, and experiment contracts must follow the
same boundary-validation pattern. Improve structured client errors so the UI
can distinguish validation, connectivity, conflict, timeout, and broker
failures without weakening existing parsing.

## Experiment roadmap

### Repeated trials

The first suite version runs a fixed workload multiple times for each selected broker/scenario combination.

Display:

- Median throughput and p50/p95/p99 latency.
- Minimum and maximum.
- Interquartile range or another clearly documented spread measure.
- Loss, duplicates, errors, and successful trial count.
- Individual trials behind the aggregate summary.

Do not silently exclude failed trials. Show how many succeeded and preserve every terminal result.

### Parameter sweeps

Build on suites to vary one dimension at a time:

- Consumer count.
- Producer count.
- Payload size.
- Message count.

The UI should plot curves instead of ranking unrelated points in a bar chart. Sweep limits must prevent accidental creation of impractically large local workloads.

### Recovery and replay

Add broker-native experiments that intentionally interrupt consumers and then observe recovery:

- Redis Streams pending-message claim and retained-message replay.
- Kafka committed-offset recovery and explicit offset reset.
- RabbitMQ unacknowledged-message redelivery without claiming retained-log replay.
- Redis Pub/Sub subscriber absence as an explicit message-loss demonstration.

Record recovery duration, redelivered messages, duplicates, loss, and unsupported capabilities.

### Ordering and backpressure

Add sequence metadata to messages and measure ordering violations globally and within the broker's ordering scope. Allow a configurable consumer delay to demonstrate backlog growth and latency under slow consumption.

Expose broker-native backlog indicators only when their meanings are documented and not presented as interchangeable values.

### Fault injection boundary

Begin with application-controlled consumer interruption and delay. Broker restarts, network latency, and packet loss require privileged Docker control and should be a later, opt-in mode with prominent safety and environment requirements.

## Result experience

### Comparability

Keep these result areas distinct:

- Durable fan-out: Kafka and RabbitMQ.
- Durable competing consumers: Redis Streams, Kafka, and RabbitMQ.
- Ephemeral live baseline: Redis Pub/Sub only.
- Broker-native recovery and replay demonstrations.

Comparisons should use the latest selected suite or an explicit user selection, never an unexplained slice of history.

### History and analysis

Add:

- Filters for broker, scenario, status, suite, and date.
- Named experiments and optional descriptions.
- Manual comparison of compatible runs or suites.
- Saved workload presets.
- JSON and CSV export.
- Explicit deletion of selected local history.
- Stable URLs for run and suite selection.

### Environment provenance

Capture information that materially affects interpretation:

- Messaging Lab version and commit when available.
- Broker image and version.
- Workload and adapter configuration.
- Operating system, CPU architecture, and logical CPU count.
- Node.js version.
- Optional memory information.

Avoid collecting personal identifiers or unrelated host information.

## Code quality plan

- Extract run and suite orchestration from the top-level React component.
- Split broad frontend tests into component and workflow test files.
- Extract typed row-mapping helpers from the SQLite repository.
- Centralize repeated adapter utilities only where broker semantics remain visible.
- Organize CSS into tokens, layout, and component files when the current stylesheet becomes difficult to navigate.
- Add migration infrastructure before changing the persisted schema.
- Prefer small pure selectors for grouping, latest-result selection, and statistics.
- Keep cancellation, timeout, cleanup, and shutdown behavior idempotent.

Avoid a generic broker superclass. The adapters intentionally expose different delivery and recovery behavior, and excessive abstraction would hide the main subject of the project.

## Testing strategy

### Unit and component tests

- Suite lifecycle, scheduling, order strategies, and cancellation.
- Statistical summaries and incomplete-trial handling.
- Parameter sweep expansion and safety limits.
- Runtime API and SSE validation.
- Comparison-group selectors and filters.
- Database migrations and row mapping.
- Accessibility checks for forms, progress, tables, and charts.

### Integration tests

- Persistent suites against real Docker brokers.
- Consumer interruption, recovery, replay, and redelivery.
- Ordering and slow-consumer behavior.
- Cleanup after every terminal state.
- API restart while a suite is active.

### End-to-end tests

Use a browser test for the critical path from suite creation to aggregate results. Cover reload during an active suite, SSE reconnection, cancellation, filtering, and export.

Performance assertions in CI should focus on correctness and broad sanity checks. Do not enforce narrow absolute throughput or latency thresholds on shared runners.

## Documentation plan

- Update the README as user-visible capabilities ship.
- Add experiment recipes with expected observations, not expected rankings.
- Add a result-interpretation guide covering distributions and semantic limits.
- Add troubleshooting for Docker, ports, broker startup, and orphaned resources.
- Add a messaging glossary.
- Add contributing and release guidance.
- Record important architectural decisions as short ADRs.
- Keep diagrams, screenshots, API documentation, and environment variables synchronized with the implementation.

## Delivery milestones

### Milestone A — Maintainable orchestration

Refactor frontend lifecycle handling, preserve runtime validation for new
contracts, improve structured client errors, split tests, and introduce
database migrations.

### Milestone B — Reproducible suites

Persist suites, schedule them in the API, survive browser reloads, support cancellation, and group their runs in the UI.

### Milestone C — Repeated evidence

Add repetitions, order strategies, cooldowns, environment snapshots, aggregate statistics, and suite export.

### Milestone D — Scaling experiments

Add safe one-dimensional parameter sweeps and curve visualizations.

### Milestone E — Behavior under stress

Add recovery, replay, ordering, and backpressure experiments with broker-specific explanations.

### Milestone F — Publication quality

Complete browser E2E coverage, accessibility review, contributor documentation, troubleshooting, ADRs, and updated screenshots.

## Non-goals for this phase

- Universal broker rankings.
- Distributed load generation across multiple hosts.
- Production capacity planning or service-level guarantees.
- Cloud deployment, authentication, or multi-user collaboration.
- Automatic privileged fault injection by default.
- Hiding broker-specific behavior behind a falsely uniform abstraction.
