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
