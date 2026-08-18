# Messaging Lab — Implementation Checklist

## 1. Repository and workspace foundation

- [x] Initialize the folder as a Git repository using `main` as the default branch.
- [x] Create npm workspaces for `apps/web`, `apps/api`, and `packages/shared`.
- [x] Add root scripts for development, build, lint, type checking, tests, and Docker workflows.
- [x] Configure TypeScript, ESLint, Prettier, and shared workspace aliases.
- [x] Add `.gitignore`, `.editorconfig`, `.env.example`, and an MIT license.
- [x] Add a minimal CI workflow for install, lint, type check, unit tests, and builds.

## 2. Local infrastructure

- [ ] Create Docker Compose services for Redis, Kafka in KRaft mode, and RabbitMQ with its management interface.
- [ ] Pin image versions and configure named volumes, health checks, ports, and local-only credentials.
- [ ] Add API and web container builds and a full-stack `docker compose up --build` workflow.
- [ ] Document local ports and verify that all health checks become ready from a clean start.

## 3. Shared domain contracts

- [ ] Define broker identifiers, scenario identifiers, run statuses, capability flags, and metric types.
- [ ] Define Zod schemas for starting a run and for all API responses and SSE events.
- [ ] Define the common broker-adapter interface and resource-cleanup contract.
- [ ] Define safe defaults and validation limits for message count, payload size, concurrency, consumers, and timeout.
- [ ] Add unit tests for schemas and validation boundaries.

## 4. API foundation and persistence

- [ ] Bootstrap the Fastify API with configuration validation, structured errors, logging, and graceful shutdown.
- [ ] Configure SQLite and create the schema for runs, configuration, aggregate metrics, notes, and errors.
- [ ] Add a repository layer for creating, updating, listing, and retrieving runs.
- [ ] Mark interrupted `pending` or `running` records appropriately when the API restarts.
- [ ] Implement `GET /api/brokers`, `GET /api/runs`, and `GET /api/runs/:id`.
- [ ] Add API and persistence unit tests.

## 5. Broker adapters

- [ ] Implement Redis connection health and resource cleanup.
- [ ] Implement Redis Pub/Sub fan-out.
- [ ] Implement Redis Streams competing consumers, acknowledgements, recovery, and replay demonstration.
- [ ] Implement Kafka connection health, topic provisioning, and resource cleanup.
- [ ] Implement Kafka fan-out using separate consumer groups.
- [ ] Implement Kafka competing consumers, offset commits, recovery, and replay demonstration.
- [ ] Implement RabbitMQ connection health, exchange/queue provisioning, and resource cleanup.
- [ ] Implement RabbitMQ fan-out exchanges with one queue per subscriber.
- [ ] Implement RabbitMQ competing consumers with acknowledgements and recovery.
- [ ] Return explicit capability metadata for unsupported broker/scenario combinations.
- [ ] Add Docker-backed integration tests for every adapter and supported scenario.

## 6. Benchmark engine

- [ ] Generate isolated resource names and deterministic payloads for each run.
- [ ] Implement warm-up, timed publishing, consumption tracking, and bounded latency sampling.
- [ ] Calculate elapsed time, throughput, p50/p95/p99 latency, counts, loss, duplicates, and errors.
- [ ] Enforce a single active run and return a conflict when another run is requested.
- [ ] Implement timeout, cancellation, failure handling, and cleanup in all terminal paths.
- [ ] Persist aggregate results and capability notes in SQLite.
- [ ] Implement `POST /api/runs` and `POST /api/runs/:id/cancel`.
- [ ] Implement the SSE event stream at `GET /api/runs/:id/events`.
- [ ] Add unit tests for metrics and lifecycle behavior and integration tests for complete runs.

## 7. Dashboard

- [ ] Bootstrap the React/Vite application and shared API client.
- [ ] Build the application shell and broker-health overview.
- [ ] Build the experiment form with validated inputs and broker/scenario capability guidance.
- [ ] Connect live progress, status, errors, and cancellation through SSE and API calls.
- [ ] Build run-history and run-detail views.
- [ ] Add throughput and latency comparison charts.
- [ ] Add the broker capability matrix and educational explanations of semantic differences.
- [ ] Implement loading, empty, running, completed, failed, timed-out, cancelled, and disconnected states.
- [ ] Add component tests for the experiment workflow and main UI states.

## 8. End-to-end verification

- [ ] Add an automated smoke test that starts the stack and completes a default experiment.
- [ ] Verify fan-out and competing-consumer runs for all three brokers.
- [ ] Verify replay and recovery only where supported and confirm unsupported states are displayed accurately.
- [ ] Verify that run history survives application restarts.
- [ ] Verify cleanup after completion, cancellation, timeout, and failure.
- [ ] Measure a clean local run and ensure the default workload completes in a practical time.
- [ ] Extend CI with Docker-backed integration and smoke tests.

## 9. Documentation and GitHub readiness

- [ ] Write the README with project goals, architecture, broker comparison, prerequisites, and quick-start commands.
- [ ] Document benchmark methodology, configuration, limitations, and responsible interpretation of results.
- [ ] Document the API endpoints and environment variables.
- [ ] Add architecture and messaging-flow diagrams.
- [ ] Add dashboard screenshots after the UI is stable.
- [ ] Run the complete lint, type-check, test, build, and smoke-test suite from a clean checkout.
- [ ] Review repository contents for secrets, generated files, and machine-specific paths.
- [ ] Prepare the first local commit; leave remote repository creation and push to the project owner.
