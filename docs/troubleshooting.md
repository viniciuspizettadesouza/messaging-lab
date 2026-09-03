# Troubleshooting

Start with `docker compose ps` and the API health endpoint at
<http://localhost:3000/health>. Use `npm run docker:logs` for the normal
development project, or target an exact Compose project when diagnosing an
isolated test stack.

## Docker is unavailable or unhealthy

Confirm that Docker Engine is running and that Compose is available:

```sh
docker version
docker compose version
npm run docker:config
```

The full stack needs at least 4 GB of memory available to Docker. Kafka and
RabbitMQ can take longer than Redis to become healthy on a cold start. Inspect
one service without discarding its state:

```sh
docker compose ps
docker compose logs kafka
docker compose logs rabbitmq
```

Ordinary `npm run docker:down` retains named volumes. Use
`docker compose down --volumes` only when you intentionally want to delete all
normal-project broker and SQLite data.

## A port is already in use

Every published port has an override in `.env.example`. Set the conflicting
host port before starting Compose, for example:

```sh
REDIS_PORT=6380 API_PORT=3001 WEB_PORT=5174 npm run docker:up
```

When the API runs from source, its broker URL must use the matching host port:

```sh
REDIS_PORT=6380 docker compose up --detach --wait redis kafka rabbitmq
REDIS_URL=redis://:messaging@localhost:6380 npm run dev
```

Kafka's advertised host listener also depends on `KAFKA_PORT`; recreate its
container after changing that value. See [local development](local-development.md)
for the complete port table.

## A broker never becomes ready

Check the service health and recent logs first. Common causes are insufficient
Docker memory, a stale container created with different environment settings,
or a host-port conflict.

```sh
docker compose ps
docker compose logs --tail 200 redis kafka rabbitmq
```

Restart only the affected service before considering data removal:

```sh
docker compose restart kafka
```

If persisted development data is intentionally disposable, stop the exact
project and remove its volumes. This deletes benchmark history and broker data,
so export anything valuable first:

```sh
docker compose down --volumes
```

Do not use broad Docker prune commands as a troubleshooting shortcut.

## Source mode cannot connect to brokers

The API defaults target broker host ports: Redis at `localhost:6379`, Kafka at
`localhost:9092`, and RabbitMQ at `localhost:5672`. Compose-internal names such
as `redis:6379` work inside containers but not from a host-run API.

Check `.env` or the shell environment for `REDIS_URL`, `KAFKA_BROKERS`, and
`RABBITMQ_URL`. If the broker password changed, update both the Compose
credential and the corresponding API URL. The dashboard's Vite server proxies
`/api` to `http://localhost:3000`, so a changed source-mode API port may also
require the matching Vite proxy configuration.

## SSE progress stops updating

Run and suite event streams send a comment heartbeat every 15 seconds. A
browser reconnect receives the retained in-memory history, and the client
deduplicates events by their sequence. Reloading the page does not cancel a
server-managed suite.

Check, in order:

1. `GET /health` still responds.
2. The run or suite detail endpoint shows current persisted state.
3. The browser network panel shows an open `text/event-stream` response.
4. A reverse proxy has buffering disabled and does not impose a short idle
   timeout. The included Nginx configuration disables buffering under `/api/`.
5. API logs do not show a validation or broker error.

Event history is process-local and bounded. Run streams retain 500 events and
suite streams retain 1,000. After an API restart, a suite stream synthesizes
persisted progress, summary, and status rather than replaying the old process's
full event history. Active runs become failed and active suites become stopped;
they are not resumed under potentially changed host conditions.

## SQLite migration or version errors

The API applies pending migrations transactionally at startup using
`PRAGMA user_version`. If the database version is newer than this application
supports, use the matching or newer application rather than editing the version
number. Downgrades are not supported.

For a failed migration, preserve the database and read the complete API error
before retrying. Do not partially apply migration SQL or change an existing
migration. A failed migration rolls back both its schema statements and version
advance.

If this is disposable local data, stop the stack and intentionally remove its
named volumes. For source mode, move the exact SQLite file to a backup location
before starting with a new database. Never delete a path derived from an
unverified or empty `DATABASE_URL`.

## Playwright cannot launch Chromium

Install the pinned browser binary once:

```sh
npm run test:e2e:install
```

`npm run test:e2e` starts an isolated production Compose stack. If a compatible
stack is already running, set `E2E_BASE_URL` and use
`npm run test:e2e:browser`. Preserve the Playwright trace, screenshot, and video
from a failure until the cause is understood.

## An isolated test left resources behind

E2E projects are named `messaging-lab-e2e-<pid>` and smoke projects are named
`messaging-lab-smoke-<pid>`. The scripts normally remove their containers and
volumes in `finally`, including after a test failure. A forced process kill can
prevent cleanup.

List matching projects and confirm the exact stale project name:

```sh
docker compose ls
docker ps --all --filter label=com.docker.compose.project
```

Then remove only that confirmed project:

```sh
docker compose --project-name messaging-lab-e2e-12345 down --volumes --remove-orphans
```

Replace the example with the exact stale name. Never remove the default
`messaging-lab` project or broad sets of volumes unless that data is explicitly
disposable.

## A run reports cleanup failures

Run cleanup is attempted after completion, cancellation, timeout, and failure.
The original lifecycle result and cleanup errors remain in history. Do not
delete the history entry until the failure has been investigated.

Inspect broker and API logs for the run-specific resource name. Prefer a
broker-native listing and deletion of that exact topic, stream, exchange, or
queue. History deletion only removes SQLite records and intentionally does not
contact brokers or retry cleanup.
