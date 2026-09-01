# Messaging glossary

Messaging Lab uses these terms narrowly so experiments with different delivery
guarantees are not mistaken for interchangeable benchmarks.

## Comparison taxonomy

**Primary comparison track** is the Kafka-versus-RabbitMQ architectural
trade-off, compared only inside the same fan-out or competing-consumer pattern.

**Adjacent streaming track** contains Redis Streams. It is summarized
independently because its stream and pending-entry mechanics differ from both
current primary adapters.

**Ephemeral baseline track** contains Redis Pub/Sub. Its measurements provide
live-delivery context but never enter a durable-system winner or ranking.

**Semantic contrast** is a manual selection spanning tracks. Values remain
visible in separate groups, with no shared aggregate or conclusion.

## Delivery and durability

**Ephemeral delivery** sends messages only to consumers that are connected at
publication time. Messages are not retained for an absent consumer. Redis
Pub/Sub is the lab's ephemeral live-delivery baseline.

**Durable delivery** retains a message in broker-managed storage long enough for
the configured consumer to receive it under the broker's acknowledgement and
retention rules. Durable does not mean permanent: retention limits, expiry,
acknowledgement, and deletion still apply.

**Acknowledgement** is a consumer or client signal that processing reached the
broker-specific completion point. The consequence differs by broker: an
acknowledged queue message may be removed, while a committed Kafka offset marks
consumer progress without deleting the log entry.

## Distribution patterns

**Fan-out** gives each independent subscriber a copy of every message. In this
lab, Kafka uses an independent consumer group per subscriber and RabbitMQ uses
an independent queue per subscriber. Redis Pub/Sub also fans out, but only to
currently connected subscribers.

**Competing consumers** share work so one consumer in the group handles each
message. Distribution need not be even; readiness, partitions, scheduling, and
acknowledgement timing influence which consumer receives work.

## Failure behavior

**Recovery** is resuming delivery after a consumer interruption. Recovery may
redeliver unacknowledged work or continue from stored consumer progress.

**Redelivery** is delivery of a message again because its prior processing was
not acknowledged or committed. It is not the same as replay and may produce a
duplicate at the application boundary.

**Replay** is an intentional later read of retained messages, usually from a
chosen position. Kafka and Redis Streams can retain data for replay. RabbitMQ
can redeliver unacknowledged messages but does not offer retained-log replay,
and Redis Pub/Sub offers neither behavior.

**Message loss** means fewer messages were observed than the workload expected.
For ephemeral delivery during subscriber absence this is expected semantics;
for a durable workload it indicates a failure or configuration problem that
must remain visible in the result.

## Ordering and pressure

**Global ordering** is the arrival order observed by the benchmark across a
subscriber path or competing-consumer group. It is stricter than most broker
guarantees and is reported independently.

**Native ordering scope** is the broker structure in which order has a defined
meaning: a Kafka consumer-group partition, RabbitMQ queue, or Redis stream. Matching labels do
not imply matching guarantees or processing completion order.

**Consumer delay** is an application-controlled pause before a measured
delivery is recorded and acknowledged. It demonstrates slow-consumer effects
without controlling Docker, the network, or broker processes.

**Observed backlog** is the number of expected deliveries already published
but not yet seen at the application boundary. It is not a broker-native lag,
queue-depth, or pending-entry measurement.
