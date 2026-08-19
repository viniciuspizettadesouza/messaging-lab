# Benchmark methodology

Messaging Lab measures a deliberately small common baseline across Redis, Kafka, and RabbitMQ. It makes semantic differences explicit instead of treating unlike guarantees as equivalent.

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
consumers; recovery experiments will populate that measure.

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

## Responsible interpretation

1. Decide which delivery guarantees the application requires before comparing speed.
2. Hold payload, message count, concurrency, consumers, host load, and Docker resources constant.
3. Run each configuration repeatedly and compare distributions or medians, not a single best result.
4. Treat small differences as noise unless they reproduce consistently.
5. Record software versions and machine specifications when sharing results.
6. Reproduce the intended production topology and tuning before making an architecture decision.

Messaging Lab is best used to learn how semantics affect observable behavior and to form hypotheses for application-specific testing.
