# Messaging Lab — Implementation Plan

## Summary

Messaging Lab is a local-first dashboard for comparing Redis, Kafka, and RabbitMQ through common messaging patterns and broker-native capabilities. It will use TypeScript, Node.js, React, Fastify, Docker Compose, and SQLite, and will be structured as a standalone repository ready for publication on GitHub.

The project is educational rather than a universal performance ranking. Its documentation and interface must explain that results depend on the host machine, broker configuration, workload, and delivery semantics.

## Architecture

- Use npm workspaces with a React/Vite frontend, a Fastify API, and a shared package for contracts, broker abstractions, and metrics.
- Run Redis, single-node Kafka in KRaft mode, and RabbitMQ with its management interface through Docker Compose.
- Pin broker images and application dependencies for reproducible runs.
- Store run configuration, lifecycle state, aggregate metrics, capability notes, and errors in SQLite.
- Stream live run progress from the API to the dashboard with Server-Sent Events (SSE).
- Allow only one benchmark run at a time to reduce local resource contention and misleading comparisons.

## Messaging Scenarios

### Common baseline

- **Live fan-out:** Redis Pub/Sub, Kafka subscribers in separate consumer groups, and RabbitMQ fanout exchanges with separate queues.
- **Competing consumers:** Redis Streams consumer groups, Kafka consumers in one consumer group, and RabbitMQ consumers sharing one queue.

### Native capabilities

- Demonstrate retention, acknowledgements, consumer recovery, and replay where each broker supports them.
- Present unsupported behavior explicitly instead of simulating equivalence. In particular, Redis Pub/Sub has no persistence and RabbitMQ does not provide Kafka-style arbitrary replay from a retained log.
- Generate isolated topic, stream, exchange, and queue names for every run and clean them up afterward.

## Benchmark Methodology

- Accept configurable message count, payload size, producer concurrency, and consumer count.
- Default to 10,000 messages with a 1 KB payload, one producer, and a short warm-up phase.
- Measure total elapsed time, throughput, p50/p95/p99 end-to-end latency, published and received messages, message loss, duplicate delivery, and errors.
- Use monotonic timestamps within the same host process for latency calculations.
- Keep a bounded in-memory latency sample and persist only aggregate results, avoiding a database row for every message.
- Support cancellation and enforce run timeouts so an unavailable consumer or broker cannot leave an experiment running indefinitely.

## Dashboard

- Show broker connectivity and health.
- Provide controls for selecting a broker, scenario, message count, payload size, producer concurrency, and consumer count.
- Display live status, progress, and errors while a run is active.
- Show comparison charts, result details, historical runs, and a capability matrix explaining semantic differences.
- Keep the interface and all public documentation in English; keep code identifiers in English as well.

## API and Shared Contracts

- `GET /api/brokers` — return broker health and supported capabilities.
- `POST /api/runs` — validate and start a benchmark run.
- `GET /api/runs` — return run history with filters suitable for the dashboard.
- `GET /api/runs/:id` — return configuration, status, metrics, notes, and errors for one run.
- `GET /api/runs/:id/events` — stream progress and lifecycle events over SSE.
- `POST /api/runs/:id/cancel` — request graceful cancellation of an active run.
- Define request, response, event, scenario, broker, run-status, and metric schemas in the shared workspace package using Zod.
- Keep broker URLs and credentials in environment variables, with working local defaults supplied by Docker Compose.

## Reliability and Error Handling

- Reject a new run while another run is active with a clear conflict response.
- Report unavailable brokers without preventing the rest of the dashboard from loading.
- Close producers, consumers, SSE connections, and database resources during shutdown.
- Record terminal states for completed, failed, timed-out, and cancelled runs.
- Clean up broker resources on success, failure, timeout, and cancellation whenever the broker remains reachable.

## Testing and Acceptance

- Unit-test request validation, metric aggregation, percentile calculations, lifecycle transitions, and capability mappings.
- Integration-test every broker adapter against its real Docker service for publishing, consuming, fan-out, competing consumers, acknowledgements, and supported replay.
- Verify unavailable-broker, timeout, cancellation, restart, duplicate-delivery, and cleanup paths.
- Test API endpoints and SSE event delivery.
- Test the dashboard's main loading, empty, running, success, and failure states.
- Add a smoke test proving that `docker compose up --build` starts the stack and that a default experiment completes.
- Configure CI to run linting, type checking, unit tests, production builds, and Docker-backed integration tests.

## Repository Deliverables

- Initialize this folder as an independent Git repository.
- Add `.gitignore`, `.env.example`, formatting and linting configuration, an MIT license, and GitHub Actions workflows.
- Write an English README covering architecture, messaging semantics, prerequisites, commands, methodology, limitations, interpretation guidance, and screenshots.
- Prepare the repository for GitHub, but do not create or push a remote repository as part of the initial implementation.

## Assumptions

- The application is for local use and requires no authentication or cloud deployment.
- Docker Compose is the supported way to run the complete stack.
- Fastify is used to keep the API small and typed while providing structured validation, lifecycle hooks, and straightforward SSE support.
- SQLite is sufficient because benchmarks run serially and results are local.
