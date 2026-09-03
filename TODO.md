# Messaging Lab — Implementation Checklist

This checklist continues from the completed MVP. Items are ordered by dependency; each section should leave the repository in a usable and documented state.

The completed baseline records what was built under the original three-system comparison model. Section 16 introduces the researched comparison taxonomy that future work must follow and includes the retrofit needed for already completed result surfaces.

## Completed MVP baseline

- [x] Create the TypeScript npm workspace with React, Fastify, and shared contracts.
- [x] Run Redis, Kafka, RabbitMQ, the API, and the web application with Docker Compose.
- [x] Implement broker adapters for live fan-out and competing consumers.
- [x] Implement benchmark execution, metrics, persistence, cancellation, timeout, cleanup, and SSE progress.
- [x] Build broker health, experiment configuration, run detail, history, comparisons, and capability guidance.
- [x] Add unit, component, integration, smoke, build, lint, and type-check automation.
- [x] Document architecture, API usage, local development, methodology, and the initial dashboard.
- [x] Validate successful API responses and SSE events with shared Zod schemas.
- [x] Filter run history by broker and status and return pagination metadata from the API.
- [x] Add a sequential six-run action to the dashboard.
- [x] Separate Redis Pub/Sub from durable performance comparisons.

## 10. Phase 2 foundations

- [x] Extract individual-run lifecycle and SSE handling from `App` into a focused hook or controller.
- [x] Extract comparison grouping and latest-result selection into pure, unit-tested selectors.
- [x] Preserve runtime Zod validation when suite and experiment contracts are added.
- [x] Preserve structured API error codes in the web client instead of reducing errors to message strings.
- [x] Split the broad web test file into component and workflow test files.
- [x] Add versioned SQLite migration infrastructure and migration tests.
- [x] Extract typed database row-mapping helpers from the repository layer.
- [x] Review broker adapters for small shared lifecycle and cleanup utilities without hiding broker semantics.
- [x] Document terminology for ephemeral, durable, fan-out, competing consumers, recovery, and replay.

## 11. Persistent benchmark suites

- [x] Define suite identifiers, statuses, configuration, progress, summary, and event schemas in the shared package.
- [x] Add suite configuration limits for repetitions, cooldown, combinations, and total generated runs.
- [x] Add SQLite tables for suites and ordered suite-run membership.
- [x] Implement a suite repository with create, update, list, and detail operations.
- [x] Implement a server-side scheduler that respects the single-active-run rule.
- [x] Persist the complete execution order before the first run starts.
- [x] Support fixed, rotating, and reproducibly randomized order strategies.
- [x] Implement cooldown between runs using abortable scheduling.
- [x] Stop queued work and cancel the active run when a suite is cancelled.
- [x] Mark an interrupted suite as stopped during API restart recovery.
- [x] Implement `POST /api/suites`.
- [x] Implement `GET /api/suites` and `GET /api/suites/:id`.
- [x] Implement `GET /api/suites/:id/events` with replayable SSE state.
- [x] Implement `POST /api/suites/:id/cancel`.
- [x] Add unit tests for scheduling, ordering, failure continuation policy, cancellation, and restart recovery.
- [x] Add API tests for every suite endpoint and event transition.

## 12. Suite experience in the dashboard

- [x] Replace the client-side “Run all 6” implementation with suite creation through the API.
- [x] Remove the browser-owned six-run queue after server-managed suites are available.
- [x] Allow users to choose broker/scenario combinations included in a suite.
- [x] Add repetition count, order strategy, and cooldown controls with safe defaults.
- [x] Display the current combination, repetition, overall progress, and remaining runs.
- [x] Restore an active suite after page reload.
- [x] Show failed, timed-out, and cancelled trials without silently dropping them.
- [x] Add suite history and suite-detail views.
- [x] Group individual runs under their suite while keeping standalone runs visible.
- [x] Add stable URL selection for runs and suites.
- [x] Add accessible progress announcements and keyboard navigation.
- [x] Add component tests for configuration, live progress, reload restoration, cancellation, and terminal states.

## 13. Repeated trials and statistical summaries

- [x] Calculate successful and unsuccessful trial counts for each broker/scenario combination.
- [x] Calculate median, minimum, maximum, and interquartile range for throughput and latency.
- [x] Aggregate loss, duplicates, redeliveries, and errors without hiding individual results.
- [x] Define and document the treatment of warm-up and failed trials.
- [x] Show aggregate summaries with access to every underlying trial.
- [x] Replace single-value rankings with distribution-aware visualizations where repetitions exist.
- [x] Show a clear warning when too few successful trials exist for a useful summary.
- [x] Add unit tests for statistics, empty samples, partial failures, and outliers.
- [x] Add JSON and CSV export for a suite and its underlying runs.

## 14. Environment provenance and reproducibility

- [x] Define a privacy-conscious environment snapshot contract.
- [x] Capture application version, Node.js version, OS, architecture, and logical CPU count.
- [x] Capture broker image tags and broker versions when available.
- [x] Persist the resolved workload, adapter configuration, order, and cooldown.
- [x] Display provenance alongside suite results.
- [x] Include provenance in JSON and CSV exports.
- [x] Document which host factors can invalidate comparisons between suites.

## 15. History, filtering, and manual comparison

- [x] Extend the existing API filters with scenario, suite, and date range.
- [x] Add pagination controls to the dashboard using the API's existing `total`, `limit`, and `offset` metadata.
- [x] Add dashboard filters that synchronize with the URL.
- [x] Allow users to select compatible runs or suites for manual comparison.
- [x] Reject or clearly separate semantically incompatible selections.
- [x] Allow suites and standalone runs to have a name and optional description.
- [x] Add saved local workload presets.
- [x] Add explicit deletion for selected runs or suites with confirmation.
- [x] Define cascade and broker-resource behavior for local history deletion.
- [x] Add repository, API, and UI tests for filtering, pagination, selection, and deletion.

## 16. Semantic comparison realignment

- [x] Add an ADR defining the primary Kafka-versus-RabbitMQ architectural trade-off comparison, the adjacent Redis Streams track, the Redis Pub/Sub baseline, and broker-native demonstrations.
- [x] Document the official-source evidence for retained logs, queue consumption, routing, acknowledgements, replay, consumer groups, and ephemeral delivery.
- [x] Add an explicit comparison-track identifier to shared suite, summary, selection, and export contracts without invalidating existing persisted runs.
- [x] Classify existing runs deterministically from broker and scenario when reading legacy data.
- [x] Make Kafka and RabbitMQ the only participants in default primary-comparison charts and summaries.
- [x] Move Redis Streams results into a separate adjacent-streaming panel with independent summaries and explanatory copy.
- [x] Keep Redis Pub/Sub in a separate ephemeral-baseline panel and prohibit durable-system rankings against it.
- [x] Allow mixed-track suites as scheduling containers while keeping their aggregates, charts, and conclusions separated by track.
- [x] Relabel cross-track manual selections as semantic contrasts and remove shared winners, rankings, and combined aggregates.
- [x] Explain partition-bound Kafka parallelism, RabbitMQ queue/exchange topology, Redis Streams pending-entry state, and the limits of identical workload inputs.
- [x] Update README, methodology, architecture, API examples, glossary, and dashboard copy to use the same taxonomy.
- [x] Add selector, contract, migration-compatibility, API, and UI tests for every track boundary.
- [x] Evaluate a future RabbitMQ Streams adapter as the prerequisite for a mechanism-level retained-stream comparison with Kafka.

## 17. Parameter sweep experiments

- [x] Define a one-dimensional sweep contract and maximum generated-work limit.
- [x] Generate safe consumer-count sweeps.
- [x] Generate safe producer-count sweeps.
- [x] Generate safe payload-size sweeps.
- [x] Generate safe message-count sweeps.
- [x] Reuse suite scheduling, repetition, ordering, cooldown, and cancellation.
- [x] Add curve charts with configuration values on the x-axis.
- [x] Keep Kafka-versus-RabbitMQ, Redis Streams, and Redis Pub/Sub sweep curves in their respective comparison tracks.
- [x] Explain saturation, diminishing returns, and local-machine limitations.
- [x] Add tests for sweep expansion, validation limits, progress, and visualization selectors.

## 18. Recovery and replay experiments

- [x] Define broker-native experiment types instead of forcing them into the common performance comparison.
- [x] Add application-controlled consumer interruption at a deterministic progress point.
- [x] Demonstrate Redis Streams pending-message recovery and retained-message replay.
- [x] Demonstrate Kafka committed-offset recovery and explicit offset reset.
- [x] Demonstrate RabbitMQ unacknowledged-message redelivery.
- [x] Demonstrate Redis Pub/Sub loss while no subscriber is connected.
- [x] Record recovery time, redelivered messages, duplicates, loss, and errors.
- [x] Report unsupported replay behavior explicitly.
- [x] Guarantee resource cleanup after interruption, cancellation, timeout, and failure.
- [x] Add Docker-backed integration tests for every recovery path.
- [x] Add an educational UI that explains the expected and observed behavior.

## 19. Ordering and backpressure experiments

- [x] Add producer and per-key sequence metadata to the benchmark message envelope.
- [x] Measure global and broker-native-scope ordering violations separately.
- [x] Document Kafka partition ordering, RabbitMQ queue delivery ordering, and Redis Stream ID ordering as separate native scopes rather than corresponding guarantees.
- [x] Add configurable artificial consumer delay.
- [x] Track backlog or lag only where its broker-specific meaning is clear.
- [x] Plot throughput, latency, and backlog behavior as consumer delay increases.
- [x] Record whether loss or duplicates occur during slow consumption and recovery.
- [x] Add unit and Docker-backed integration tests for ordering and slow-consumer behavior.

## 20. End-to-end reliability and accessibility

- [x] Add Playwright and a minimal browser-test configuration.
- [x] Test suite creation through aggregate result display against the Docker stack.
- [x] Test page reload during an active suite.
- [x] Test SSE disconnect and reconnection without duplicated terminal handling.
- [x] Test suite and standalone-run cancellation from the browser.
- [x] Test filtering, manual comparison, and export.
- [x] Test that mixed-track suites and selections cannot produce combined rankings or aggregates.
- [x] Add automated accessibility checks for the main dashboard states.
- [x] Verify keyboard operation and readable progress announcements manually.
- [x] Keep CI performance assertions limited to correctness and broad sanity bounds.

## 21. Documentation and publication quality

- [x] Add `CONTRIBUTING.md` with setup, architecture boundaries, tests, and conventions.
- [x] Add `docs/experiment-recipes.md` with reproducible workloads and expected observations.
- [x] Add `docs/interpreting-results.md` covering medians, spread, outliers, and semantic limits.
- [x] Add `docs/troubleshooting.md` for Docker, ports, broker startup, SSE, and orphaned resources.
- [x] Add `docs/glossary.md` for messaging and benchmark terminology.
- [x] Add an ADR for serial execution and server-managed suites.
- [x] Cross-check the semantic comparison ADR from section 16 against all public documentation and screenshots.
- [x] Document database migrations, suite endpoints, events, and environment snapshots.
- [x] Update architecture and messaging-flow diagrams for suites and recovery experiments.
- [x] Refresh dashboard screenshots after the suite UI stabilizes.
- [x] Add a changelog or release-note process before publishing versioned releases.
- [x] Run the complete lint, format, type-check, unit, integration, E2E, build, and smoke suite from a clean checkout.

## Later ideas — not currently scheduled

- [ ] Opt-in Docker-controlled broker restart experiments.
- [ ] Opt-in network latency and packet-loss injection.
- [ ] Multi-host load generation.
- [ ] Import and compare exported suite files.
- [ ] Additional brokers or hosted broker services.
- [ ] RabbitMQ Streams and super streams for a retained-log comparison with Kafka.

These items require additional safety, reproducibility, or product decisions and should not delay the core Phase 2 milestones.
