# Messaging Lab roadmap

## Status

Messaging Lab has completed its local-first MVP and Phase 2 experimentation
roadmap. It can run, persist, stream, compare, filter, export, and explain
benchmark suites across Kafka, RabbitMQ, Redis Streams, and Redis Pub/Sub while
preserving their semantic boundaries.

The current product includes:

- live fan-out and competing-consumer workloads;
- server-managed serial suites with repetitions, persisted ordering, cooldown,
  cancellation, and restart recovery;
- one-dimensional parameter and consumer-delay sweeps;
- distribution-aware summaries and explicit unsuccessful trials;
- ordering, application-observed backlog, recovery, replay, and redelivery
  observations;
- SQLite history, filtering, stable selections, manual comparison, deletion,
  JSON/CSV export, and environment provenance;
- runtime-validated API and SSE contracts;
- accessible browser workflows plus unit, integration, E2E, and smoke tests;
  and
- publication-quality contributor, experiment, reference, decision, and
  release documentation.

## Product boundaries

- Compare Kafka and RabbitMQ only within the same named fan-out or
  competing-consumer goal.
- Summarize Redis Streams independently as an adjacent retained-stream
  mechanism.
- Use Redis Pub/Sub only as an ephemeral live-delivery baseline.
- Treat recovery and replay as broker-native demonstrations, not performance
  rankings.
- Run benchmarks serially by default and persist suite order before execution.
- Prefer repeated measurements, visible failures, and environment provenance
  over single-run conclusions.
- Keep unsupported behavior explicit and avoid abstractions that hide broker
  semantics.

The accepted rationale is recorded in
[ADR 0001](docs/adr/0001-semantic-comparison-tracks.md) and
[ADR 0002](docs/adr/0002-serial-server-managed-suites.md).

## Possible next work

These ideas are intentionally unscheduled. Each requires a separate design and
safety decision:

- opt-in Docker-controlled broker restart experiments;
- opt-in network latency and packet-loss injection;
- multi-host load generation;
- importing and comparing exported suites;
- RabbitMQ Streams and super streams for a retained-log study with Kafka; and
- additional brokers or hosted services.

RabbitMQ Streams is the prerequisite for a closer retained-stream comparison
with Kafka. The existing RabbitMQ queue adapter must not be relabeled as a
retained log.

## Delivery priorities

When selecting future work, prefer this order:

1. Correctness and reproducibility improvements.
2. Automation that reduces release or contributor friction.
3. Experiments with a clear broker-native contract and cleanup boundary.
4. New systems only after their comparison track and interpretation are
   explicit.
