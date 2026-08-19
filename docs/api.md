# HTTP API and configuration

The Fastify API listens on `http://localhost:3000` by default. All JSON contracts are defined and validated with Zod in `packages/shared`.

## Endpoints

### `GET /health`

Returns API process health.

```json
{ "status": "ok" }
```

### `GET /api/brokers`

Returns Redis, Kafka, and RabbitMQ protocol health plus capability metadata for each scenario. A broker can be unhealthy without preventing information about the other brokers from loading.

### `POST /api/runs`

Validates and starts one asynchronous benchmark. Returns `202 Accepted` with the pending run. Returns `409 Conflict` when another run is active.

```json
{
  "broker": "redis",
  "scenario": "fan-out",
  "messageCount": 10000,
  "payloadSizeBytes": 1024,
  "producerConcurrency": 1,
  "consumerCount": 1,
  "timeoutMs": 120000
}
```

Only `broker` and `scenario` are required; omitted numeric values receive the documented defaults.

### `GET /api/runs`

Returns newest-first run history with full configuration, status, aggregate metrics, notes, and errors.

| Query parameter | Default | Constraints                                                              |
| --------------- | ------: | ------------------------------------------------------------------------ |
| `broker`        |       — | `redis`, `kafka`, or `rabbitmq`                                          |
| `status`        |       — | `pending`, `running`, `completed`, `failed`, `timed-out`, or `cancelled` |
| `limit`         |      20 | Integer from 1 to 100                                                    |
| `offset`        |       0 | Non-negative integer                                                     |

The response includes `runs`, `total`, `limit`, and `offset`.

### `GET /api/runs/:id`

Returns one run by UUID or `404 Not Found` when it does not exist.

### `POST /api/runs/:id/cancel`

Requests cancellation of the active run and returns `202 Accepted`:

```json
{
  "runId": "11111111-1111-4111-8111-111111111111",
  "cancellationRequested": true
}
```

Returns `409 Conflict` if the run exists but is no longer active.

### `GET /api/runs/:id/events`

Opens an SSE stream. Existing retained events are sent first, allowing a recently connected dashboard to catch up. The stream closes after a terminal status.

| SSE event  | Payload                                                       |
| ---------- | ------------------------------------------------------------- |
| `status`   | Run ID, sequence, timestamp, and lifecycle status             |
| `progress` | Phase, completed/total units, published count, received count |
| `metrics`  | Aggregate benchmark metrics                                   |
| `error`    | Structured run error                                          |

The server sends comment heartbeats on long-lived streams. Nginx proxy buffering is disabled for `/api/` so events reach the dashboard immediately.

### `POST /api/suites`

Validates, persists, and starts a server-managed suite. The complete execution
order is stored before the first trial begins. A suite reserves the single
benchmark lane until it completes or is cancelled, including cooldown periods.

```json
{
  "name": "Durable messaging comparison",
  "workload": {
    "messageCount": 10000,
    "payloadSizeBytes": 1024,
    "producerConcurrency": 1,
    "consumerCount": 1,
    "timeoutMs": 120000
  },
  "combinations": [
    { "broker": "redis", "scenario": "competing-consumers" },
    { "broker": "kafka", "scenario": "competing-consumers" },
    { "broker": "rabbitmq", "scenario": "competing-consumers" }
  ],
  "repetitions": 3,
  "orderStrategy": "rotating",
  "cooldownMs": 1000
}
```

Workload fields use the standalone-run defaults. Suite defaults are three
repetitions, fixed order, and a 1,000 ms cooldown. A suite accepts at most six
unique combinations, 20 repetitions, a 60,000 ms cooldown, and 100 generated
runs. Supported order strategies are `fixed`, `rotating`, and `randomized`.
Randomized order is generated once and persisted with the suite.

### `GET /api/suites`

Returns newest-first suites, including configuration, progress, lifecycle
summary, errors, and ordered trial membership. It accepts an optional `status`
filter plus the same `limit` and `offset` pagination fields as run history.
Suite statuses are `pending`, `running`, `completed`, `failed`, `cancelled`, and
`stopped`.

### `GET /api/suites/:id`

Returns one suite and every ordered trial. Entries for queued trials have a
null `run`; started trials embed their persisted run. `combinationSummaries`
contains success/failure counts, five-number throughput and p50/p95/p99 latency
distributions, IQR, and aggregate delivery anomalies for each configured
broker/scenario combination.

The response also includes an immutable `environment` snapshot captured when
the suite is created. It records the application version and optional commit,
Node.js version, OS/release/architecture, logical CPU count, optional total
memory, broker images and inferred versions, and sanitized adapter settings.
Legacy suites created before this contract return `environment: null`.

### `GET /api/suites/:id/export?format=json|csv`

Downloads the suite and all underlying trials. JSON uses the same validated
suite contract as the detail endpoint. CSV emits one row per ordered trial,
including queued and unsuccessful trials, configuration identity, lifecycle
timestamps, metrics, anomaly counts, errors, and environment provenance.

### `POST /api/suites/:id/cancel`

Aborts an active cooldown, cancels the active trial, and leaves remaining
ordered trials queued. Returns `202 Accepted`; terminal suites return
`409 Conflict`.

### `GET /api/suites/:id/events`

Opens a replayable SSE stream containing suite `status`, `progress`, `summary`,
`run-event`, and `error` events. A `run-event` wraps the validated SSE event for
the current trial. In-memory history is replayed on reconnect; after an API
restart the persisted progress, summary, and terminal state are synthesized.
The stream closes when the suite reaches a terminal status.

If the API restarts during a suite, active runs are marked `failed` and the
suite is marked `stopped`. Suites are not automatically resumed because host
conditions may have changed.

## Error format

Validation, lookup, conflict, and internal errors use a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": {}
  }
}
```

## Environment variables

Copy `.env.example` to `.env` for local overrides. The included credentials are local-only defaults.

| Variable                   | Default                                     | Consumer    | Purpose                                   |
| -------------------------- | ------------------------------------------- | ----------- | ----------------------------------------- |
| `NODE_ENV`                 | `development`                               | API         | Runtime mode                              |
| `API_HOST`                 | `0.0.0.0`                                   | API         | API bind address                          |
| `API_PORT`                 | `3000`                                      | API/Compose | API host port                             |
| `WEB_PORT`                 | `5173`                                      | Compose     | Dashboard host port                       |
| `DATABASE_URL`             | `./data/messaging-lab.sqlite`               | API         | SQLite file or `:memory:` in tests        |
| `MESSAGING_LAB_VERSION`    | `0.1.0`                                     | API         | Version stored in suite provenance        |
| `MESSAGING_LAB_COMMIT`     | empty                                       | API         | Optional commit stored in provenance      |
| `REDIS_PORT`               | `6379`                                      | Compose     | Redis host port                           |
| `REDIS_IMAGE`              | `redis:8.2.1-alpine3.22`                    | API/Compose | Redis image and provenance                |
| `REDIS_PASSWORD`           | `messaging`                                 | Compose     | Local Redis password                      |
| `REDIS_URL`                | `redis://:messaging@localhost:6379`         | API         | Redis connection URL                      |
| `KAFKA_PORT`               | `9092`                                      | Compose     | Kafka host port and advertised listener   |
| `KAFKA_IMAGE`              | `apache/kafka:4.0.0`                        | API/Compose | Kafka image and provenance                |
| `KAFKA_BROKERS`            | `localhost:9092`                            | API         | Comma-separated Kafka `host:port` entries |
| `RABBITMQ_PORT`            | `5672`                                      | Compose     | AMQP host port                            |
| `RABBITMQ_IMAGE`           | `rabbitmq:4.1.3-management-alpine`          | API/Compose | RabbitMQ image and provenance             |
| `RABBITMQ_MANAGEMENT_PORT` | `15672`                                     | Compose     | RabbitMQ management host port             |
| `RABBITMQ_USER`            | `messaging`                                 | Compose     | Local RabbitMQ user                       |
| `RABBITMQ_PASSWORD`        | `messaging`                                 | Compose     | Local RabbitMQ password                   |
| `RABBITMQ_URL`             | `amqp://messaging:messaging@localhost:5672` | API         | AMQP connection URL                       |
| `RABBITMQ_MANAGEMENT_URL`  | `http://localhost:15672`                    | API         | RabbitMQ management URL                   |

Inside Compose, broker URLs are replaced with service-network addresses such as `redis:6379`, `kafka:29092`, and `rabbitmq:5672`.

## Security scope

The API has no authentication and is designed only for local use. Published ports bind to `127.0.0.1`. Do not expose the stack publicly or reuse the example credentials in another environment.
