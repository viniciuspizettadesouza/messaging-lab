# Architecture and messaging flows

## System topology

```mermaid
flowchart TB
    subgraph Browser
      UI[React + Vite dashboard]
      Client[Validated API client]
      UI --> Client
    end

    subgraph API[Fastify API process]
      Routes[HTTP and SSE routes]
      Manager[Single-run lifecycle manager]
      Scheduler[Persistent suite scheduler]
      Engine[Benchmark engine]
      Repo[Run repository]
      SuiteRepo[Suite repository]
      Events[Bounded event store]
      Routes --> Manager --> Engine
      Routes --> Scheduler --> Manager
      Scheduler --> SuiteRepo
      Manager --> Repo
      Manager --> Events --> Routes
    end

    Client -->|JSON requests| Routes
    Routes -->|SSE status, progress, metrics, errors| Client
    Repo --> SQLite[(SQLite)]
    Engine --> Redis[(Redis)]
    Engine --> Kafka[(Kafka)]
    Engine --> RabbitMQ[(RabbitMQ)]
```

The shared workspace owns the Zod schemas consumed by both applications. API
responses and incoming SSE events are validated at the web boundary. Validation
failures and structured server errors remain distinct from connectivity,
conflict, timeout, and broker failures in the client.

## Sequential runners

The dashboard's “Run all 6 sequentially” action is a client-side convenience.
It expands the selected workload into the six broker/scenario combinations and
submits one ordinary run at a time.

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant Broker

    loop Six broker/scenario combinations
      Browser->>API: POST /api/runs
      API->>Broker: Execute isolated benchmark
      API-->>Browser: SSE progress and terminal status
      Browser->>API: POST the next run
    end
```

The queue exists only in browser memory. Reloading or closing the page discards
the remaining queue, while an already active API run continues and can be
rediscovered from run history.

The API also exposes persistent suites. Suite clients submit a normalized
workload, broker/scenario combinations, repetitions, ordering strategy, and
cooldown. The scheduler persists every ordered position first, then starts one
ordinary run at a time through the same lifecycle manager. The dashboard will
move to this API in the next UI milestone.

```mermaid
sequenceDiagram
    participant Client
    participant Scheduler
    participant RunManager
    participant SQLite

    Client->>Scheduler: POST /api/suites
    Scheduler->>SQLite: Persist suite and complete order
    loop Every ordered trial
      Scheduler->>RunManager: Start one run
      RunManager->>SQLite: Persist lifecycle and result
      RunManager-->>Scheduler: Terminal run
      Scheduler->>Scheduler: Abortable cooldown
    end
    Scheduler->>SQLite: Persist terminal suite state
```

Fixed order repeats the selected combinations unchanged. Rotating order shifts
the first combination each repetition. Randomized order is shuffled once and
stored, so reconnects and later inspection see the exact executed sequence.
Failed, timed-out, and individually cancelled trials remain in the suite and do
not prevent later trials from running.

## Run lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> running
    running --> completed
    running --> failed
    running --> timed_out: timeout
    running --> cancelled: cancellation
    pending --> failed: startup failure
    completed --> cleanup
    failed --> cleanup
    timed_out --> cleanup
    cancelled --> cleanup
    cleanup --> [*]
```

Only one run may be pending or running. The manager uses an abort signal for timeout, cancellation, and graceful shutdown. Cleanup is attempted in every terminal path, and cleanup failures are persisted separately.

## Live fan-out

```mermaid
flowchart LR
    P[Producer]

    subgraph Redis
      RP[Pub/Sub channel]
      RS1[Subscriber 1]
      RS2[Subscriber 2]
      RP --> RS1
      RP --> RS2
    end

    subgraph Kafka
      KT[Topic]
      KG1[Consumer group A]
      KG2[Consumer group B]
      KT --> KG1
      KT --> KG2
    end

    subgraph RabbitMQ
      RE[Fanout exchange]
      RQ1[Queue 1]
      RQ2[Queue 2]
      RE --> RQ1
      RE --> RQ2
    end

    P --> RP
    P --> KT
    P --> RE
```

Each fan-out subscriber is expected to observe every message. Redis Pub/Sub is live-only; Kafka groups and RabbitMQ queues add persistence and acknowledgement behavior.

## Competing consumers

```mermaid
flowchart LR
    P[Producer]

    subgraph Redis
      Stream[Stream + consumer group]
      RC1[Consumer 1]
      RC2[Consumer 2]
      Stream --> RC1
      Stream --> RC2
    end

    subgraph Kafka
      Topic[Topic + shared group]
      KC1[Consumer 1]
      KC2[Consumer 2]
      Topic --> KC1
      Topic --> KC2
    end

    subgraph RabbitMQ
      Queue[Shared queue]
      QC1[Consumer 1]
      QC2[Consumer 2]
      Queue --> QC1
      Queue --> QC2
    end

    P --> Stream
    P --> Topic
    P --> Queue
```

One consumer handles each message. Distribution depends on consumer readiness, broker scheduling, Kafka partition assignment, and acknowledgement timing; an even split is not guaranteed.

## Persistence model

SQLite stores run state plus suite configuration, lifecycle, errors, and ordered
suite-run membership. Versioned, transactional migrations advance `user_version`
before repositories access the database; a database from a newer application
version is rejected. Typed row mappers translate storage columns into the
shared runtime-validated domain model. Individual message timings are
deliberately kept out of the database. Named Docker volumes retain SQLite and
broker data across ordinary `docker compose down` and restart operations.

An API restart marks pending/running runs as failed and pending/running suites
as stopped. Automatic suite continuation is intentionally disabled because a
restart may change the benchmark environment. Graceful suite cancellation and
shutdown abort both cooldown timers and any active trial.
