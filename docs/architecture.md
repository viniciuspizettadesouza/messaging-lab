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
      Engine[Benchmark engine]
      Repo[Run repository]
      Events[Bounded event store]
      Routes --> Manager --> Engine
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

The shared workspace owns the Zod schemas consumed by both applications. API responses and incoming SSE events are validated at the web boundary.

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

SQLite stores one run row, one optional aggregate-metrics row, capability notes, and run errors. Individual message timings are deliberately kept out of the database. Named Docker volumes retain SQLite and broker data across ordinary `docker compose down` and restart operations.
