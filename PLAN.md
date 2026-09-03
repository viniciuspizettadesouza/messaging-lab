# Messaging Lab — Product and Engineering Plan

## Project status

Messaging Lab has a complete local-first MVP. It can run live fan-out and competing-consumer workloads against Redis, Kafka, and RabbitMQ; stream progress; persist results in SQLite; and explain the semantic differences between the systems.

The Phase 2 roadmap through documentation and publication quality is complete
as of 2026-09-03. Remaining ideas are intentionally unscheduled and require
separate safety, reproducibility, or product decisions.

The next phase turns the project from a collection of individual benchmark runs into a reproducible experimentation environment. Its primary product-decision comparison is Kafka versus RabbitMQ. Redis remains in the lab as a separate adjacent-technology track: Redis Streams for focused stream-processing experiments and Redis Pub/Sub as an ephemeral live-delivery baseline. The priorities are repeatability, correctness, failure behavior, and clear interpretation—not producing a universal broker ranking.

## Product principles

- Compare Kafka and RabbitMQ only under a named application goal and an explicitly normalized delivery contract.
- Describe Kafka-versus-RabbitMQ results as an architectural trade-off comparison, not as proof that their storage and consumption models are equivalent.
- Keep Redis Streams outside the primary Kafka-versus-RabbitMQ rankings and summaries; use it in a separate adjacent streaming track.
- Keep Redis Pub/Sub separate as an ephemeral live-delivery baseline and loss demonstration.
- Prefer repeated measurements and distributions over single-run conclusions.
- Record enough environment and configuration data to reproduce a result.
- Treat message loss, duplicates, ordering, recovery, and replay as first-class outcomes.
- Run benchmarks serially by default to reduce local resource contention.
- Make unsupported behavior explicit instead of simulating equivalence.
- Compare mechanisms, not product names: queues, retained logs/streams, and ephemeral pub/sub require different experiment contracts.
- Keep the application, code identifiers, and public documentation in English.

## Comparison taxonomy and research basis

The plan uses the following taxonomy, based on the systems' official documentation:

- **Kafka** is an event-streaming platform built around durable event streams, partitioned logs, consumer-controlled offsets, replay, and consumer groups. A consumer group can approximate queue-style work distribution, but work is assigned by partition and consumption remains non-destructive while records are retained.
- **RabbitMQ queues and exchanges** implement routed messaging. Exchanges route publications to queues; consumers normally receive pushed deliveries and acknowledge them, after which the queue may delete them. Shared queues provide competing consumers, while one bound queue per subscriber provides durable fan-out.
- **RabbitMQ Streams** are a separate RabbitMQ data structure with append-only, non-destructive consumption, offsets, replay, and partitioned super streams. They are a closer mechanism-level comparison to Kafka than RabbitMQ queues, but the current lab adapter does not implement them.
- **Redis Streams** are an append-only Redis data type with ordered IDs, consumer groups, acknowledgements, pending-entry recovery, replay, and configurable trimming. They overlap with dedicated event-streaming systems for focused workloads, but remain an adjacent Redis capability rather than a participant in the primary Kafka-versus-RabbitMQ decision comparison.
- **Redis Pub/Sub** provides at-most-once live delivery with no persistence, replay, or consumer recovery. It is not a durable-messaging performance comparator.

Authoritative references:

- [Apache Kafka introduction](https://kafka.apache.org/intro/) and [design documentation](https://kafka.apache.org/43/design/design/)
- [Kafka consumer groups and offsets](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
- [RabbitMQ exchanges](https://www.rabbitmq.com/docs/exchanges), [consumers](https://www.rabbitmq.com/docs/consumers), and [reliability](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ Streams](https://www.rabbitmq.com/docs/streams)
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/) and [streaming guidance](https://redis.io/docs/latest/develop/use-cases/streaming/)
- [Redis Pub/Sub delivery semantics](https://redis.io/docs/latest/develop/pubsub/)

These sources support overlap at the use-case level, not universal interchangeability. Every result surface must therefore identify both the application goal and the broker-native mechanism being exercised.

## Phase 2 goals

1. Make benchmark suites persistent and independent of the browser.
2. Support repeated trials and statistically useful summaries.
3. Add parameter sweeps for consumers, producers, payload size, and message count.
4. Add controlled recovery, replay, ordering, and backpressure experiments.
5. Realign suites, result grouping, and documentation around the comparison taxonomy.
6. Improve result discovery, filtering, comparison, and export.
7. Reduce orchestration complexity in the frontend and preserve runtime validation as contracts expand.
8. Expand end-to-end testing, accessibility, operational documentation, and contributor guidance.

## Architecture evolution

### Persistent benchmark suites

A suite is a server-managed collection of runs. It owns the execution order and continues even if the dashboard disconnects or reloads.

The suite model should include:

- A unique suite identifier, name, status, and timestamps.
- A normalized workload configuration shared by its runs.
- The comparison track and broker/scenario combinations included in the suite.
- The repetition count, execution order strategy, and cooldown duration.
- Ordered run references with combination and repetition indexes.
- Progress, stop reason, and aggregate summary.
- An environment snapshot captured when the suite starts.

The API remains responsible for enforcing one active benchmark run. A suite scheduler starts the next run only after the current run reaches a terminal state and the configured cooldown has elapsed.

Initial order strategies:

- `fixed`: deterministic order for debugging.
- `rotating`: shift the first broker between repetitions to reduce order bias.
- `randomized`: persist a generated order so the suite remains reproducible.

Suites may schedule runs from more than one track for convenience, but aggregation and visualization must never merge tracks. A mixed suite is an experiment collection, not a single comparison population.

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

The first suite version runs a fixed workload multiple times for each selected broker/scenario combination. Statistical summaries are grouped first by comparison track and then by broker/scenario combination.

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

The UI should plot curves instead of ranking unrelated points in a bar chart. Kafka and RabbitMQ curves may share a primary-comparison chart only when they implement the same named application goal and normalized contract. Redis Streams and Redis Pub/Sub use separate panels. Sweep limits must prevent accidental creation of impractically large local workloads.

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

- Primary durable fan-out trade-off: Kafka consumer groups versus RabbitMQ exchange plus one durable queue per subscriber.
- Primary competing-worker trade-off: Kafka consumer group versus RabbitMQ shared durable queue.
- Adjacent retained-stream experiments: Redis Streams, reported independently; it may be contrasted with Kafka only in a specifically named mechanism study.
- Ephemeral live baseline: Redis Pub/Sub only, with no durable-system ranking.
- Broker-native recovery and replay demonstrations.

Comparisons should use the latest selected suite or an explicit user selection, never an unexplained slice of history. A chart or table may juxtapose different tracks for education, but it must be labelled as a semantic contrast and must not calculate a winner, shared rank, or combined aggregate.

Kafka and RabbitMQ remain different even inside the primary track. Result explanations must call out partition-limited Kafka consumer parallelism, consumer-controlled offsets and replay, RabbitMQ routing topology, acknowledgements, prefetch, redelivery, and destructive queue consumption. Identical message counts and payloads normalize load generation; they do not make these mechanisms identical.

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
- Track-boundary enforcement for suites, summaries, manual selections, exports, and charts.
- Database migrations and row mapping.
- Accessibility checks for forms, progress, tables, and charts.

### Integration tests

- Persistent suites against real Docker brokers.
- Consumer interruption, recovery, replay, and redelivery.
- Ordering and slow-consumer behavior.
- Cleanup after every terminal state.
- API restart while a suite is active.

### End-to-end tests

Playwright covers suite creation through aggregate results against an isolated
Docker Compose stack, including active-suite reload, SSE reconnection,
suite/run cancellation, history filtering, manual comparison, JSON/CSV export,
and mixed-track boundary checks. Axe scans the initial and populated dashboard
states, while browser keyboard checks cover navigation and history traversal.

Performance assertions in CI should focus on correctness and broad sanity checks. Do not enforce narrow absolute throughput or latency thresholds on shared runners.

## Documentation plan

- Update the README as user-visible capabilities ship.
- Add experiment recipes with expected observations, not expected rankings.
- Add a result-interpretation guide covering distributions and semantic limits.
- Record the comparison taxonomy and its evidence in an ADR, including why Redis is retained but removed from the primary comparison.
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

Realign existing result grouping, then add safe one-dimensional parameter sweeps and track-specific curve visualizations.

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
- Ranking Redis, Kafka, and RabbitMQ together as if product category or a shared message envelope made them equivalent.
- Claiming a Kafka-versus-RabbitMQ retained-stream comparison until a RabbitMQ Streams adapter and matching experiment contract exist.
