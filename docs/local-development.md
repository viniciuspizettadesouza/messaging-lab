# Local development

The complete local stack runs with Docker Compose:

```sh
cp .env.example .env
npm run docker:up
```

All published ports bind to `127.0.0.1`, so the services are only exposed to
the local machine. The credentials in `.env.example` are development-only
defaults and must not be reused outside this local environment.

## Local ports

| Service             | URL or address           | Purpose                      |
| ------------------- | ------------------------ | ---------------------------- |
| Dashboard           | <http://localhost:5173>  | Web interface                |
| API                 | <http://localhost:3000>  | HTTP API and health endpoint |
| Redis               | `localhost:6379`         | Redis client connections     |
| Kafka               | `localhost:9092`         | Kafka client connections     |
| RabbitMQ            | `localhost:5672`         | AMQP client connections      |
| RabbitMQ management | <http://localhost:15672> | Broker management interface  |

The API health endpoint is available at <http://localhost:3000/health>.

Every port can be overridden with the corresponding variable from
`.env.example`. For example, use `REDIS_PORT=6380 npm run docker:up` when the
default Redis port is already occupied.

Use `npm run docker:logs` to follow service logs and `npm run docker:down` to
stop the stack. Run `docker compose down --volumes` when you intentionally want
to remove all locally persisted broker and application data.

## Run applications from source

Start only the broker containers:

```sh
docker compose up --detach --wait redis kafka rabbitmq
```

Then run the shared-package compiler, API reload process, and Vite development
server together:

```sh
npm install
npm run dev
```

Vite serves the dashboard at <http://localhost:5173> and proxies `/api` to the
API at <http://localhost:3000>. The API reloads when its TypeScript source
changes; shared contracts are rebuilt in watch mode.

The source workflow reads the API connection URLs from the shell environment.
When overriding a broker host port, update its API URL as well. For example:

```sh
REDIS_PORT=6380 docker compose up --detach redis kafka rabbitmq
REDIS_URL=redis://:messaging@localhost:6380 npm run dev
```

## Verification

Unit, API, persistence, and component tests do not require Docker:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Docker-backed adapter and benchmark tests expect healthy brokers on the default
ports:

```sh
docker compose up --detach --wait redis kafka rabbitmq
npm run test:integration
```

The smoke test creates its own Compose project, ports, and volumes. It builds
the complete stack, runs a default 10,000-message experiment, restarts the API,
verifies persisted history, and removes its resources:

```sh
npm run test:smoke
```

## Browser end-to-end tests

Install Playwright's Chromium binary once:

```sh
npm run test:e2e:install
```

Then run the browser suite:

```sh
npm run test:e2e
```

The command builds and starts a dedicated Docker Compose project on isolated
ports, runs Playwright against the production web container, and removes its
containers and volumes afterward. The initial scenario creates a small real
Redis suite and verifies the browser workflow through persisted aggregate
results. Override the dedicated ports with `E2E_API_PORT`, `E2E_WEB_PORT`,
`E2E_REDIS_PORT`, `E2E_KAFKA_PORT`, `E2E_RABBITMQ_PORT`, and
`E2E_RABBITMQ_MANAGEMENT_PORT` when needed.

When an E2E stack is already running, `npm run test:e2e:browser` runs only
Playwright. Set `E2E_BASE_URL` if the dashboard is not available at
`http://127.0.0.1:25173`.
