# ADR 0001: Semantic comparison tracks

- Status: Accepted
- Date: 2026-08-28

## Context

Similar workload inputs do not make messaging mechanisms equivalent. Kafka
retains records in partitioned logs and tracks group offsets; RabbitMQ routes
publications through exchanges into queues and normally removes acknowledged
queue deliveries; Redis Streams retains entries while separately tracking group
delivery and pending-entry state. Redis Pub/Sub retains nothing for disconnected
subscribers.

## Decision

Every result has one deterministic `comparisonTrack`:

| Identifier           | Participants                                      | Interpretation                                                                |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `primary`            | Kafka and RabbitMQ, within the same scenario only | The primary trade-off: retained partitioned log versus queue/exchange routing |
| `adjacent-streaming` | Redis Streams competing consumers                 | An independently summarized adjacent retained-stream mechanism                |
| `ephemeral-baseline` | Redis Pub/Sub fan-out                             | Live, at-most-once context only; never a durable-system ranking participant   |

Suites may contain any mixture because they are scheduling containers. Status
counts, distributions, charts, manual-selection conclusions, and exports retain
the track boundary. Cross-track selections are semantic contrasts and have no
winner, ranking, or combined aggregate. Legacy rows are classified from
`broker` and `scenario` when read, so no historical run is invalidated.

## Broker-native demonstrations

- Kafka fan-out uses one topic and one consumer group per subscriber. Kafka
  competing consumers use one shared group and one partition per requested
  consumer. Parallel consumption in this adapter is partition-bound.
- RabbitMQ fan-out uses a fanout exchange and one durable queue per subscriber.
  Competing consumers share one durable queue. Publications are persistent,
  publisher confirms are awaited, and deliveries use explicit acknowledgements.
- Redis Streams uses one stream and one consumer group. `XREADGROUP` assigns
  entries, `XACK` clears pending state, and unacknowledged entries remain in the
  group's pending entries list.
- Redis Pub/Sub uses a channel and currently connected subscribers. It has no
  acknowledgement, retained history, recovery cursor, or replay.

## Evidence

| Property                     | Official-source evidence                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retained logs and replay     | Kafka documents durable event streams, retention after consumption, partitions, and repeated reads. [Kafka introduction](https://kafka.apache.org/intro/)                                                                                                                                                        |
| Kafka groups and parallelism | A partition is consumed by one member of a subscribing group at a time; position and committed position are offsets per partition. This bounds conventional group parallelism by partition count. [Kafka consumer API](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html) |
| RabbitMQ routing             | Exchanges route publications according to exchange type and bindings; fanout exchanges copy to every bound destination. [RabbitMQ exchanges](https://www.rabbitmq.com/docs/exchanges)                                                                                                                            |
| RabbitMQ acknowledgements    | Explicit consumer acknowledgements mark successful processing and permit deletion; connection loss can requeue unacknowledged deliveries. [RabbitMQ acknowledgements and confirms](https://www.rabbitmq.com/docs/confirms)                                                                                       |
| Redis Streams groups         | Streams are append-only logs; groups divide entries, acknowledgements update group state, and `XPENDING` exposes unacknowledged entries. [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)                                                                                               |
| Redis Pub/Sub ephemerality   | Pub/Sub is at-most-once; a delivery missed because of disconnect or failure is lost and cannot be resent. [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)                                                                                                                                          |

## Limits of identical inputs

Matching message count, payload size, producers, consumers, and timeout controls
some variables. It does not equalize partition count, batching, pull versus push
delivery, routing topology, acknowledgement state, retention, replication,
client defaults, or cleanup. Results describe these adapter demonstrations on
one host, not mechanism-neutral broker rankings.

## Consequences

Default primary charts contain Kafka and RabbitMQ only. Redis panels have their
own summaries and explanatory copy. Shared run, suite-trial, suite-summary,
selection, and export contracts expose track identity and reject a track that
does not match its broker/scenario classification.

A future RabbitMQ Streams adapter is the prerequisite for a closer
mechanism-level retained-stream comparison with Kafka. It would require a new
track decision; the current queue adapter must not be treated as a retained log.

Practical workload and interpretation guidance is consolidated in the
[experiment guide](../experiments.md).
