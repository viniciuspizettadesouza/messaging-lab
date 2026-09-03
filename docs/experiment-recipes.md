# Experiment recipes

These recipes turn common Messaging Lab questions into repeatable workloads.
They specify inputs and interpretation boundaries, but intentionally do not
predict a fastest broker or set machine-independent performance thresholds.

Before collecting results, start the stack as described in
[local development](local-development.md), close unrelated heavy workloads,
record Docker resource limits, and wait for all three brokers to report
healthy. Prefer at least five repetitions when interpreting a distribution.

## Durable fan-out trade-off

**Question:** How do the Kafka and RabbitMQ adapters behave when every durable
subscriber must receive every message?

| Setting               | Value                           |
| --------------------- | ------------------------------- |
| Comparison track      | Primary                         |
| Combinations          | Kafka fan-out; RabbitMQ fan-out |
| Messages              | 10,000                          |
| Payload               | 1,024 bytes                     |
| Producers             | 1                               |
| Consumers/subscribers | 3                               |
| Artificial delay      | 0 ms                            |
| Repetitions           | 5                               |
| Order                 | Rotating                        |
| Cooldown              | 1,000 ms                        |

Create a named suite such as `Durable fan-out baseline`. Confirm that expected
deliveries equal messages multiplied by subscribers. Compare medians, spread,
loss, duplicates, and unsuccessful trials within this scenario only.

Kafka uses one consumer group per subscriber over a retained partitioned log.
RabbitMQ uses one durable queue per subscriber bound to a fanout exchange and
acknowledges deliveries. Equal inputs do not equalize those mechanisms. Delete
the suite from History after exporting it if you no longer need the local
record; broker resources are already handled by terminal run cleanup.

## Competing-consumer scale sweep

**Question:** How does worker count affect one shared work stream on this host?

| Setting          | Value                                  |
| ---------------- | -------------------------------------- |
| Comparison track | Primary                                |
| Combinations     | Kafka and RabbitMQ competing consumers |
| Messages         | 20,000                                 |
| Payload          | 1,024 bytes                            |
| Producers        | 1                                      |
| Base consumers   | 1                                      |
| Sweep            | Consumer count: 1, 2, 4, 8             |
| Repetitions      | 5                                      |
| Order            | Rotating                               |
| Cooldown         | 1,000 ms                               |

Inspect each track-specific curve for flattening throughput, rising latency,
or wider spread. A knee can indicate local saturation, coordination overhead,
or contention; repeat it before treating it as meaningful.

Kafka parallelism is partition-bound. This adapter creates one partition per
requested competing consumer. RabbitMQ consumers share one queue, with
prefetch and acknowledgement timing affecting distribution. Do not infer a
general broker scalability limit from this single-node local topology.

## Redis Streams adjacent study

**Question:** What does a retained Redis consumer-group workload look like
without folding it into the primary comparison?

| Setting          | Value                     |
| ---------------- | ------------------------- |
| Comparison track | Adjacent streaming        |
| Combination      | Redis competing consumers |
| Messages         | 10,000                    |
| Payload          | 1,024 bytes               |
| Producers        | 1                         |
| Consumers        | 2                         |
| Repetitions      | 5                         |
| Order            | Fixed                     |
| Cooldown         | 1,000 ms                  |

Run this as its own suite or as a combination in a mixed scheduling suite.
Either way, inspect it in the Redis Streams panel. Its summary must remain
independent from Kafka and RabbitMQ primary results.

Redis Streams retains ordered entries and uses a consumer group with pending
entry state and explicit acknowledgements. It is useful adjacent evidence, not
a claim that the tested Redis topology is interchangeable with Kafka.

## Redis Pub/Sub absence and loss

**Question:** What happens when publications occur while no subscriber is
connected?

In **Recovery and replay lab**, select **Redis Pub/Sub disconnected-subscriber
loss** and run the default demonstration: five messages with the deterministic
interruption after message two.

| Property             | Value                                      |
| -------------------- | ------------------------------------------ |
| Comparison track     | Ephemeral baseline                         |
| Persistence          | Unsupported                                |
| Recovery             | Unsupported                                |
| Replay               | Unsupported                                |
| Expected observation | Offline publications are unavailable later |

Record the observed lost-message count and explanation. This demonstrates an
at-most-once live-delivery boundary; it is not a durable performance result and
must not participate in a Kafka or RabbitMQ ranking. Recovery results are
returned synchronously and are not stored in run or suite history.

## Native recovery and replay tour

**Question:** How do acknowledgement, offset, and retention mechanisms differ?

Run each Recovery and replay lab option once, leaving the default deterministic
interruption at message two of five:

| Experiment                                 | Expected mechanism                                         |
| ------------------------------------------ | ---------------------------------------------------------- |
| Redis Streams pending-message recovery     | A replacement claims and acknowledges a pending entry      |
| Redis Streams retained-message replay      | Retained entries are read again from the beginning         |
| Kafka committed-offset recovery            | A replacement resumes from the last committed group offset |
| Kafka explicit offset-reset replay         | The group resets to earliest and reads retained records    |
| RabbitMQ unacknowledged-message redelivery | Closing the channel requeues an unacknowledged delivery    |
| Redis Pub/Sub disconnected-subscriber loss | Offline messages remain unavailable                        |

Compare expected and observed text, recovery time, redeliveries, duplicates,
loss, errors, and cleanup evidence. Treat RabbitMQ redelivery as recovery, not
retained-log replay. Do not compare recovery duration as a product ranking:
each row intentionally exercises a different native mechanism.

## Slow-consumer response

**Question:** How do application-observed backlog and latency change when
message handling slows?

| Setting          | Value                                  |
| ---------------- | -------------------------------------- |
| Comparison track | Primary                                |
| Combinations     | Kafka and RabbitMQ competing consumers |
| Messages         | 5,000                                  |
| Payload          | 1,024 bytes                            |
| Producers        | 1                                      |
| Consumers        | 4                                      |
| Sweep            | Consumer delay: 0, 1, 5, 10 ms         |
| Repetitions      | 3                                      |
| Order            | Rotating                               |
| Cooldown         | 1,000 ms                               |

Inspect throughput, p95 latency, and maximum observed backlog on their separate
curves. Also check loss, duplicates, and ordering violations at every point.
The backlog is publications expected by the application minus unique
deliveries observed by it. It is not Kafka consumer lag, RabbitMQ queue depth,
or Redis pending-entry count.

Consumer delay is applied before a measured delivery is recorded and
acknowledged. The result demonstrates this adapter and host under deliberate
application pressure; it does not model network delay, broker failure, or a
production service's processing distribution.

## Sharing a result

Export the suite as JSON for its complete validated structure or CSV for one
row per ordered trial. Share the recipe inputs, suite name, comparison track,
environment snapshot, Docker limits, and all unsuccessful trials with the
result. See [interpreting results](interpreting-results.md) before drawing a
conclusion.
