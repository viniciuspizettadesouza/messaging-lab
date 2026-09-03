# Experiment guide

This guide defines Messaging Lab's comparison boundaries, workloads, metrics,
recipes, and interpretation rules. Results describe one adapter topology,
configuration, environment, and host—not a universal broker ranking.

## Comparison tracks

| Track              | Mechanisms                                  | Valid interpretation                                    |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| Primary            | Kafka and RabbitMQ within the same scenario | An architectural trade-off for one application goal     |
| Adjacent streaming | Redis Streams competing consumers           | An independently summarized retained-stream observation |
| Ephemeral baseline | Redis Pub/Sub fan-out                       | Live-delivery and absence/loss context only             |

A mixed suite shares scheduling and workload inputs, not statistics or a
winner. Kafka fan-out must not be ranked against RabbitMQ competing consumers.
Manual cross-track selections are semantic contrasts with no combined
aggregate. Recovery experiments are separate broker-native demonstrations.

See [ADR 0001](adr/0001-semantic-comparison-tracks.md) for the evidence and
formal decision.

## Run model

A benchmark run:

1. validates its configuration and acquires the single-run lane;
2. provisions run-specific broker resources and connects consumers;
3. publishes an untimed warm-up of 1% of message count, clamped to 1–100;
4. measures publication through expected consumption with monotonic time;
5. records aggregate delivery, latency, ordering, and backlog observations;
6. persists the terminal result; and
7. attempts idempotent cleanup after every terminal path.

Provisioning, warm-up, and cleanup are outside the measured interval. At most
10,000 latency observations are retained through reservoir sampling;
per-message timings are never persisted.

### Workload limits

| Field                |    Default |  Minimum |    Maximum |
| -------------------- | ---------: | -------: | ---------: |
| Messages             |     10,000 |        1 |  1,000,000 |
| Payload bytes        |      1,024 |        1 |  1,048,576 |
| Producer concurrency |          1 |        1 |         32 |
| Consumers            |          1 |        1 |         64 |
| Consumer delay       |       0 ms |     0 ms |  10,000 ms |
| Timeout              | 120,000 ms | 1,000 ms | 600,000 ms |

Fan-out expects `messages × subscribers` unique deliveries. Competing
consumers expect one unique delivery per message. Throughput counts original
publications, not fan-out amplification.

Suites allow 1–20 repetitions, 0–60,000 ms cooldown, up to six unique
combinations, and no more than 100 generated runs. A sweep varies exactly one
of consumer count, producer concurrency, payload size, message count, or
consumer delay across 2–20 unique increasing values.

## Metrics and statistics

- **Elapsed time:** measured publication through expected consumption.
- **Throughput:** published measured messages divided by elapsed seconds.
- **p50/p95/p99 latency:** nearest-rank percentiles of sampled end-to-end
  latency.
- **Loss:** expected unique deliveries minus observed unique deliveries,
  clamped at zero.
- **Duplicates:** deliveries beyond the first scenario-specific uniqueness key.
- **Global ordering violations:** sequence regressions at the observed
  subscriber or worker-group boundary.
- **Native-scope violations:** per-producer/key regressions within the reported
  Kafka partition, RabbitMQ queue, or Redis stream scope.
- **Observed backlog:** expected submitted deliveries not yet observed by the
  application.

Observed backlog is not Kafka consumer lag, RabbitMQ queue depth, or Redis
pending entries. Native ordering labels are also not equivalent guarantees:
Kafka ordering is partition-bound; RabbitMQ delivery can be affected by
multiple consumers, acknowledgement, redelivery, and priority; Redis Stream
IDs are ordered while consumer-group processing may complete differently.

Repeated-trial summaries use only completed trials with persisted metrics for
their distributions. They report minimum, Q1, median, Q3, maximum, IQR, and
sample size. Quartiles use linear interpolation at `(n - 1) × p`. Fewer than
three successful trials produces a low-sample warning.

Failed, timed-out, cancelled, queued, and metric-less completed trials do not
enter latency or throughput distributions, but remain visible in counts,
errors, ordered trials, and exports. A clean median alongside frequent failures
is not a healthy result.

## Reproducible recipes

Before a suite, wait for healthy brokers, close unrelated heavy workloads,
record Docker limits, and keep host conditions stable. Use at least five
repetitions when a distribution will inform a decision.

### Durable fan-out

| Setting      | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Track        | Primary                                                        |
| Combinations | Kafka and RabbitMQ fan-out                                     |
| Workload     | 10,000 messages; 1,024-byte payload; 1 producer; 3 subscribers |
| Suite        | 5 repetitions; rotating order; 1,000 ms cooldown               |

Confirm that expected deliveries equal messages multiplied by subscribers.
Kafka uses one consumer group per subscriber over a retained partitioned log;
RabbitMQ uses one durable queue per subscriber bound to a fanout exchange.
Compare distributions and anomalies only within this fan-out goal.

### Competing-consumer scale

| Setting      | Value                                            |
| ------------ | ------------------------------------------------ |
| Track        | Primary                                          |
| Combinations | Kafka and RabbitMQ competing consumers           |
| Workload     | 20,000 messages; 1,024-byte payload; 1 producer  |
| Sweep        | Consumers: 1, 2, 4, 8                            |
| Suite        | 5 repetitions; rotating order; 1,000 ms cooldown |

Look for repeatable curve shape, spread, loss, and errors. Kafka parallelism is
partition-bound; this adapter creates one partition per requested worker.
RabbitMQ workers share one acknowledged queue with configured prefetch. Do not
infer a production capacity limit from the single-node local topology.

### Redis Streams adjacent study

| Setting     | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| Track       | Adjacent streaming                                           |
| Combination | Redis competing consumers                                    |
| Workload    | 10,000 messages; 1,024-byte payload; 1 producer; 2 consumers |
| Suite       | 5 repetitions; fixed order; 1,000 ms cooldown                |

Inspect this result only in the Redis Streams panel. Streams retain ordered
entries and track consumer-group pending state; this is adjacent evidence, not
an interchangeable Kafka benchmark.

### Slow-consumer response

| Setting      | Value                                                       |
| ------------ | ----------------------------------------------------------- |
| Track        | Primary                                                     |
| Combinations | Kafka and RabbitMQ competing consumers                      |
| Workload     | 5,000 messages; 1,024-byte payload; 1 producer; 4 consumers |
| Sweep        | Consumer delay: 0, 1, 5, 10 ms                              |
| Suite        | 3 repetitions; rotating order; 1,000 ms cooldown            |

Inspect throughput, p95 latency, and maximum observed backlog separately.
Confirm a suspected saturation point with another suite. Artificial consumer
delay models application processing pressure, not network or broker failure.

### Recovery and replay tour

Use the default deterministic interruption after message 2 of 5:

| Demonstration                      | Native behavior                                           |
| ---------------------------------- | --------------------------------------------------------- |
| Redis Streams pending recovery     | A replacement claims and acknowledges a pending entry     |
| Redis Streams retained replay      | Retained entries are read again from the beginning        |
| Kafka committed-offset recovery    | A replacement resumes from the committed group position   |
| Kafka offset-reset replay          | The group resets to earliest and reads retained records   |
| RabbitMQ unacknowledged redelivery | Closing the channel requeues an unacknowledged delivery   |
| Redis Pub/Sub offline loss         | Publications made without a subscriber remain unavailable |

Compare expected and observed text, redelivery, duplicates, loss, errors, and
cleanup evidence. RabbitMQ redelivery is recovery, not retained-log replay.
Redis Pub/Sub is an at-most-once absence/loss demonstration. These synchronous
results are not stored in performance history and their durations are not a
product ranking.

## Interpretation checklist

Before drawing a conclusion:

- name the application goal and required guarantees first;
- compare only matching primary-track scenarios;
- keep adjacent, ephemeral, and recovery evidence separate;
- use enough successful repetitions and retain every unsuccessful trial;
- read median, IQR, range, anomalies, and individual trials together;
- investigate and reproduce outliers rather than silently deleting them;
- change only one sweep dimension at a time;
- control and record host load and Docker resources; and
- validate the intended production topology separately.

Zero observed loss or duplicates does not establish an exactly-once guarantee.
A flattening curve can suggest saturation or diminishing returns, but only for
the tested environment.

## Provenance and sharing

Each suite captures application and Node.js versions; optional source commit;
OS, release, architecture, CPU count, and optional memory; broker images and
inferred versions; and sanitized client/adapter settings. It excludes hostname,
username, paths, endpoints, and credentials. Docker limits, CPU model, storage,
thermal state, and background load remain uncaptured.

JSON preserves the complete validated suite. CSV emits every ordered trial,
including status, comparison track, sweep axis, metrics, anomalies, errors, and
environment fields. Share provenance and unsuccessful trials with any derived
chart. Matching snapshots improve reproducibility but do not prove identical
conditions.

## Glossary

- **Acknowledgement:** consumer confirmation that broker-delivered work was
  processed; not the same as a publisher confirm.
- **Cooldown:** unmeasured suite delay between serial trials.
- **Durable:** broker state intended to survive consumer absence and ordinary
  restart within the tested configuration.
- **Ephemeral:** available only to currently connected subscribers.
- **Fan-out:** every subscriber receives its own logical copy.
- **Competing consumers:** workers share one logical work stream and one handles
  each message.
- **Pending entry:** a Redis Stream group delivery not yet acknowledged.
- **Recovery:** continued processing after interruption using native state.
- **Redelivery:** another delivery attempt for work not acknowledged or
  committed.
- **Replay:** intentionally reading retained records again from a selected
  position.
- **Suite:** a persisted, ordered collection of serial benchmark trials.
