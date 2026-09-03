# Benchmark methodology

Messaging Lab applies deliberately controlled workload inputs to broker-native
mechanisms. Kafka and RabbitMQ form the scenario-bound primary trade-off;
Redis Streams and Redis Pub/Sub remain separate adjacent and ephemeral tracks.
The lab makes semantic differences explicit instead of treating unlike
guarantees as equivalent.

## Run sequence

1. Validate the requested configuration and reject it if another run is active.
2. Create broker resources with names isolated by run ID.
3. Connect the requested consumers.
4. Publish an untimed warm-up equal to 1% of the requested message count, with a minimum of 1 and maximum of 100 messages.
5. Start a monotonic timer and publish the measured messages with the configured producer concurrency.
6. Track unique and duplicate deliveries until the expected delivery count is reached or the run is interrupted.
7. Calculate aggregate metrics and persist them with broker capability notes.
8. Clean up producers, consumers, topics, streams, exchanges, and queues.

Provisioning, warm-up, and cleanup are outside the measured interval. The timed interval includes publishing and the wait for expected consumption.

## Configuration

| Field                 | Default | Minimum |   Maximum | Meaning                                       |
| --------------------- | ------: | ------: | --------: | --------------------------------------------- |
| `messageCount`        |  10,000 |       1 | 1,000,000 | Messages published during measurement         |
| `payloadSizeBytes`    |   1,024 |       1 | 1,048,576 | Deterministic payload size                    |
| `producerConcurrency` |       1 |       1 |        32 | Concurrent publishing workers                 |
| `consumerCount`       |       1 |       1 |        64 | Subscribers or competing consumers            |
| `consumerDelayMs`     |       0 |       0 |    10,000 | Artificial processing delay per delivery      |
| `timeoutMs`           | 120,000 |   1,000 |   600,000 | Maximum run time, including setup and cleanup |

Payload byte `i` is deterministically generated from the message seed and position. This avoids random-generation cost and makes payload construction consistent across runs.

## Delivery expectations

- **Fan-out:** expected unique deliveries equal `messageCount × consumerCount` because every subscriber receives every measured message.
- **Competing consumers:** expected unique deliveries equal `messageCount` because one consumer in the shared group or queue handles each message.

For fan-out, uniqueness is keyed by message and consumer. For competing consumers, it is keyed by message. Deliveries beyond the first matching key are counted as duplicates.

## Metrics

| Metric                  | Definition                                                                 |
| ----------------------- | -------------------------------------------------------------------------- |
| Elapsed time            | Monotonic time from the first measured publish phase through consumption   |
| Throughput              | Published measured messages divided by elapsed seconds                     |
| p50 / p95 / p99 latency | Nearest-rank percentiles of sampled end-to-end message latency             |
| Published messages      | Successfully published measured messages                                   |
| Received messages       | All measured deliveries, including duplicates                              |
| Lost messages           | Expected unique deliveries minus observed unique deliveries, never below 0 |
| Duplicate messages      | Deliveries whose scenario-specific uniqueness key was already observed     |
| Errors                  | Aggregate run errors                                                       |
| Global order violations | Deliveries observed below the greatest prior global sequence in that path  |
| Native-scope violations | Per-producer/key regressions inside a partition, queue, or Redis stream    |
| Observed backlog        | Published expected deliveries not yet observed by the application          |

Latency timestamps use `process.hrtime.bigint()` in the same API host process before publication and after delivery. Wall-clock changes therefore do not affect latency.

The engine uses reservoir sampling with a capacity of 10,000 observations. This bounds memory for large runs while giving each observation an equal probability of inclusion. Per-message observations are never stored in SQLite.

## Repeated-trial summaries

Suites group trials by the exact broker and scenario combination. A trial is
successful only when it completes with persisted metrics. A completed trial
without metrics is counted as statistically unsuccessful. Failed, timed-out,
and cancelled trials are excluded from throughput and latency distributions,
but they remain in the status counts, error totals, exports, and ordered trial
list. Queued and running trials are reported separately and are not classified
as unsuccessful.

For each metric, the suite reports the sample size, minimum, median, maximum,
first and third quartiles, and interquartile range. Median and quartiles use
linear interpolation at positions `(n - 1) × p` in the sorted successful-trial
sample. A summary with fewer than three successful trials is shown with a
low-sample warning; its values remain available but should not be treated as a
useful distribution.

Each run performs its own untimed warm-up. Warm-up messages and timings never
enter persisted run metrics or suite distributions. Loss, duplicates, and run
errors are summed across successful trials, while errors attached to
unsuccessful trials are also counted. The redelivery aggregate is currently
zero because standard performance workloads do not intentionally interrupt
consumers; the separate recovery experiments populate that measure in their
native behavioral observations.

A suite may schedule combinations from multiple comparison tracks, but suite
status summaries include per-track counts and distributions are presented under
track headings. No cross-track median, winner, or aggregate is calculated.

## Parameter sweeps

A suite may vary exactly one workload dimension: consumer count, producer
count, payload size, message count, or artificial consumer delay. Sweep values must be unique, strictly
increasing integers inside the normal benchmark limits. Every selected
broker/scenario combination runs at every value for every repetition; the
expanded suite remains subject to the 100-run maximum. The base workload is
unchanged except for the selected dimension.

Sweep charts use the configuration value on the x-axis and the repeated-trial
median on the y-axis. Curves remain separated by comparison track. A flattening
throughput curve can suggest saturation or diminishing returns, while rising
latency can suggest contention; neither establishes a broker-wide limit. These
curves describe this local host, broker images, adapter configuration, Docker
resources, and background load. Confirm apparent knees with repeated runs and
controlled environments before drawing conclusions.

## Ordering and backpressure

Every measured message carries a global sequence, producer identity,
producer-local sequence, and stable ordering key. Global violations are
counted separately from regressions inside a broker-native ordering scope.
For fan-out, global order is evaluated per subscriber; for competing consumers
it is evaluated across the observed worker group.

Kafka's native scope is a topic partition within a consumer group, RabbitMQ's is the concrete queue,
and Redis Streams' is the stream. These labels do not claim equivalent
guarantees: Kafka ordering is partition-bound, RabbitMQ delivery order can be
affected by multiple consumers, acknowledgements, redelivery, and priorities,
and Redis Stream IDs order appended entries while consumer-group processing
can complete in a different order. Redis Pub/Sub exposes no durable native
scope in this lab, so only its application-observed global result is reported.

`consumerDelayMs` pauses measured delivery handling before recording the
observation and acknowledgement. It is application-controlled fault injection;
warm-up messages are not delayed. Loss and duplicate counters remain active,
so a slow-consumer run records anomalies instead of hiding them.

The backlog value is deliberately application-observed: expected deliveries
for publication attempts submitted by the producer minus unique deliveries seen by
the benchmark. Its maximum and final value are persisted. It is not Kafka
consumer lag, RabbitMQ ready-message depth, or Redis pending-entry count, and
those broker-native values are not combined. Delay sweeps plot median
throughput, p95 latency, and maximum observed backlog on separate curves.

## Native capability demonstrations

- Redis Streams and Kafka expose replay demonstrations because they retain an ordered log.
- Redis Streams, Kafka, and RabbitMQ demonstrate consumer recovery with broker-native acknowledgement or offset behavior where supported.
- Redis Pub/Sub reports persistence, acknowledgements, recovery, and replay as unsupported.
- RabbitMQ reports arbitrary retained-log replay as unsupported; redelivery of unacknowledged messages is recovery, not log replay.

## Limitations

- The stack uses one local node per broker, not production clusters or high-availability configurations.
- Broker defaults, client-library behavior, Docker resource limits, host load, filesystem speed, and runtime garbage collection affect results.
- The common scenarios have similar intent but different durability, ordering, batching, routing, acknowledgement, and retention semantics.
- Throughput counts original publications, not fan-out delivery amplification.
- Latency includes client and local-container transport overhead but not an external network.
- A timeout or early failure can end before complete aggregate metrics are available.
- The bounded latency sample is representative rather than exhaustive above 10,000 deliveries.
- One warm-up reduces obvious startup effects but does not establish statistical stability.

## Comparing environments

Every new suite captures a privacy-conscious environment snapshot at creation.
It includes application and runtime versions, OS release and architecture,
logical CPU count, optional total memory, configured broker images/versions,
and sanitized adapter behavior. It never records hostnames, usernames,
filesystem paths, broker addresses, or credentials. The resolved workload,
repetition count, order strategy, cooldown, and complete generated order are
persisted separately as part of the suite.

Treat suites from different environments as non-equivalent when they differ in
broker or client versions, CPU architecture/count, available memory, OS/runtime
version, Docker resource limits, power mode, or background host load. Even
matching snapshots do not prove identical conditions: CPU model, storage,
thermal throttling, virtualization, kernel tuning, and concurrent processes are
intentionally not collected. Re-run suites under controlled conditions rather
than normalizing across materially different hosts.

## Responsible interpretation

1. Decide which delivery guarantees the application requires before comparing speed.
2. Hold payload, message count, concurrency, consumers, host load, and Docker resources constant.
3. Run each configuration repeatedly and compare distributions or medians, not a single best result.
4. Treat small differences as noise unless they reproduce consistently.
5. Record software versions and machine specifications when sharing results.
6. Reproduce the intended production topology and tuning before making an architecture decision.

Manual dashboard comparisons preserve the same semantic boundaries as the
default charts. Kafka and RabbitMQ form the primary track and are compared only
within the same scenario. Redis Streams is an adjacent streaming track. Redis
Pub/Sub is an ephemeral baseline. A selection spanning tracks is labeled a
semantic contrast and produces no shared winner, ranking, or aggregate.

Equal inputs do not equalize broker mechanics. Kafka consumer-group parallelism
is bounded by topic partitions; RabbitMQ behavior depends on exchange, binding,
queue, prefetch, and acknowledgement topology; Redis Streams maintains
consumer-group pending-entry state. See
[ADR 0001](adr/0001-semantic-comparison-tracks.md) for official evidence and
the exact adapter demonstrations.

Messaging Lab is best used to learn how semantics affect observable behavior and to form hypotheses for application-specific testing.
