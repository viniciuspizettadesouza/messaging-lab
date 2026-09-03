# Interpreting results

Messaging Lab results are evidence about a named workload, adapter topology,
software environment, and host. They are not universal broker rankings.

## Start with compatibility

Every run belongs to exactly one comparison track:

| Track              | Included mechanisms                         | Valid conclusion                                     |
| ------------------ | ------------------------------------------- | ---------------------------------------------------- |
| Primary            | Kafka and RabbitMQ within the same scenario | An architectural trade-off for that application goal |
| Adjacent streaming | Redis Streams competing consumers           | An independent retained-stream observation           |
| Ephemeral baseline | Redis Pub/Sub fan-out                       | Live-delivery and loss context only                  |

Kafka fan-out must not be ranked against RabbitMQ competing consumers. Redis
Streams and Redis Pub/Sub do not join a primary aggregate. A mixed-track suite
only shares scheduling and workload inputs; its panels, statistics, and
conclusions remain separated. A manual selection spanning boundaries is a
semantic contrast, with no shared winner or aggregate.

Recovery and replay experiments are broker-native behavioral demonstrations.
Their durations and anomaly counts do not enter performance history or rank
unlike recovery mechanisms.

## Read the distribution

A suite reports a distribution only from trials that completed with persisted
metrics. For every metric it shows:

- **Minimum and maximum:** the observed range, highly sensitive to extremes.
- **Median:** the middle of the sorted sample, or the midpoint interpolation
  around it. It is less dominated by one extreme trial than the mean.
- **Q1 and Q3:** the interpolated 25th and 75th percentiles.
- **Interquartile range (IQR):** Q3 minus Q1, describing the middle half of the
  observations.
- **Sample size:** the successful trials contributing values.

A narrow IQR suggests the central trials were consistent; a wide IQR suggests
noise, instability, warm state changes, contention, or a workload near a
transition. Range and IQR answer different questions, so keep both visible.

The dashboard warns when fewer than three successful trials are available.
Those values are valid observations but not a useful distribution. Five or
more controlled repetitions are a better starting point for a decision.

## Keep outliers and failures visible

An outlier is a prompt to investigate, not an automatic deletion. Check host
load, container health, garbage collection, broker startup, thermal or power
state, and whether the point repeats. Re-run the complete suite under a named
and documented rule if a trial is invalidated; do not quietly remove the
unfavorable value.

Failed, timed-out, cancelled, queued, or metric-less completed trials are not
included in throughput and latency distributions. They remain visible in
status counts, ordered trials, errors, and exports. A clean median alongside
frequent failures is not a healthy result.

Each trial performs an untimed warm-up. Warm-up messages and timings do not
enter metrics. Warm-up reduces a startup artifact; it does not prove a stable
steady state.

## Interpret delivery anomalies

- **Loss** is expected unique deliveries minus observed unique deliveries,
  never below zero. In fan-out, the expected value is messages multiplied by
  subscribers; in competing consumers it is the message count.
- **Duplicates** are deliveries beyond the first scenario-specific uniqueness
  key. They can reflect recovery, redelivery, or processing behavior.
- **Redeliveries** identify broker-native recovery observations. Standard
  performance workloads do not intentionally interrupt consumers and
  currently aggregate zero redeliveries.
- **Errors** include unsuccessful-trial errors as well as errors summed from
  successful trials. Read the individual trial before trusting its aggregate.

Zero observed loss or duplicates does not establish an exactly-once guarantee.
It only describes what this instrumented run observed.

## Separate ordering scopes

Global ordering violations describe regressions at the application's observed
fan-out subscriber or competing-worker-group boundary. Native-scope violations
describe per-producer/key regressions within the adapter's reported scope: a
Kafka consumer-group partition, RabbitMQ queue, or Redis stream.

Those labels are not equivalent guarantees. Kafka ordering is partition-bound.
RabbitMQ delivery order can change with multiple consumers, acknowledgements,
redelivery, and priorities. Redis Stream IDs order appended entries while
consumer-group processing may complete differently. Redis Pub/Sub exposes no
durable native scope in this lab.

## Understand backlog and sweep curves

Observed backlog is the number of expected published deliveries not yet seen
by the application. It is recorded as maximum and final values. It is not a
broker metric and must not be presented as Kafka lag, RabbitMQ ready-message
depth, or Redis pending entries.

In a one-dimensional sweep, look for repeatable curve shape rather than one
best point. Flattening throughput can suggest saturation or diminishing
returns; rising latency, backlog, spread, loss, or errors can indicate pressure.
Change only one swept dimension and confirm a suspected knee with another
suite. Do not connect points from different comparison tracks.

## Check environment provenance

Each new suite captures an immutable, privacy-conscious snapshot:

- Messaging Lab version and optional commit;
- Node.js version;
- operating system, release, architecture, logical CPU count, and optional
  total memory;
- sanitized broker image names and inferred versions;
- client libraries, transport type, Kafka broker count and acknowledgement
  mode, RabbitMQ prefetch, and other non-secret adapter settings.

The snapshot excludes hostname, username, filesystem paths, endpoints, and
credentials. It also cannot capture every important factor: CPU model, storage,
thermal state, Docker resource limits, background work, virtualization, and
kernel tuning may differ.

Treat suites as non-equivalent when their captured environment or uncaptured
test conditions materially differ. Matching snapshots improve reproducibility
but do not prove identical conditions.

## Use exports responsibly

JSON preserves the complete suite contract. CSV emits every ordered trial,
including queued and unsuccessful entries, comparison track, sweep axis,
metrics, anomalies, errors, and repeated environment fields. Do not discard
status or provenance columns when sharing a chart derived from CSV.

Prefer a named suite export over a screenshot for analysis. A screenshot is a
visual overview and may contain machine-dependent illustrative measurements.

## Decision checklist

Before using a result in an architecture decision, confirm that:

- the application goal and required delivery guarantees were named first;
- only matching scenarios in the primary track were compared;
- adjacent, ephemeral, and recovery evidence stayed separate;
- workload inputs, adapter topology, host conditions, and Docker limits were
  controlled and recorded;
- there are enough successful repetitions and all failures remain visible;
- median, IQR, range, anomalies, and individual trials tell a coherent story;
- an outlier or sweep knee reproduces in a fresh suite;
- the tested single-node local topology is not being presented as production
  capacity; and
- the intended production topology and tuning will receive its own validation.

For metric definitions and calculation details, see the
[benchmark methodology](benchmark-methodology.md). For broker boundaries, see
[ADR 0001](adr/0001-semantic-comparison-tracks.md).
