# Contributing to Messaging Lab

Thank you for helping improve Messaging Lab. The project is an educational,
local-first benchmark environment, so correctness, reproducibility, and honest
descriptions of broker semantics take priority over producing a simple winner.

## Prerequisites

- Node.js 22.12 or newer
- npm 10 or newer
- Docker Engine with Docker Compose
- At least 4 GB of memory available to Docker for full-stack verification

Install the workspace dependencies and run the checks that do not need Docker:

```sh
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

For the complete application, copy the development defaults and start the
Compose stack:

```sh
cp .env.example .env
npm run docker:up
```

The dashboard is served at <http://localhost:5173> and the API at
<http://localhost:3000>. See [local development](docs/local-development.md) for
source-mode development, port overrides, logs, and browser-test setup. The
credentials in `.env.example` are local development defaults only.

## Workspace responsibilities

| Path              | Responsibility                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Zod schemas, inferred domain types, configuration limits, comparison tracks, and capability metadata shared across process boundaries |
| `apps/api`        | Fastify routes, run and suite lifecycle, benchmark and recovery engines, broker adapters, persistence, exports, and SSE event stores  |
| `apps/web`        | React dashboard, validated API client, lifecycle hooks, pure result selectors, visualizations, and accessible user interaction        |
| `tests/e2e`       | Full browser workflows against the isolated production Compose stack                                                                  |
| `scripts`         | Compose wrappers plus isolated E2E and smoke-test orchestration                                                                       |
| `docs`            | Architecture, API, methodology, terminology, accessibility, and architectural decisions                                               |

Keep code in the workspace that owns the behavior. A contract used by both the
API and web application belongs in `packages/shared`; broker connections and
persistence never belong in the browser; presentation-specific state does not
belong in shared contracts.

## Architecture boundaries

### Preserve broker semantics

Kafka and RabbitMQ form the `primary` architectural trade-off track, and only
matching application scenarios may be compared. Redis Streams belongs to the
`adjacent-streaming` track. Redis Pub/Sub belongs to the
`ephemeral-baseline` track. Mixed-track suites are scheduling containers, not
shared comparison populations.

Do not introduce a common abstraction that hides partition assignment,
consumer-controlled offsets, queue and exchange topology, acknowledgements,
pending entries, redelivery, retention, or replay support. Normalize workload
inputs where useful, but keep unsupported behavior explicit. Recovery
demonstrations must remain separate from performance rankings.

Read [ADR 0001](docs/adr/0001-semantic-comparison-tracks.md) and the
[benchmark methodology](docs/benchmark-methodology.md) before changing
adapters, result grouping, charts, exports, or explanatory copy.

### Keep execution server-owned and serial

The API owns run and suite execution. It permits one active benchmark run, and
a suite reserves that lane while scheduling its persisted order one trial at a
time. The web application creates, observes, cancels, and displays suites; it
must not maintain a browser-owned execution queue.

Cancellation, timeout, failure, and shutdown must converge on idempotent
cleanup. New resources need run-specific names and cleanup coverage for every
terminal path. Do not add automatic suite continuation after an API restart:
the environment may have changed, making the remaining results misleading.

### Keep calculations testable

Put grouping, compatibility, statistics, and visualization selection in pure
functions. Keep React components focused on rendering and interaction, and use
the lifecycle hooks for API and SSE coordination. In the API, keep scheduling
separate from ordinary run execution and keep database row mapping out of
route handlers.

## Shared contracts and API changes

The Zod schemas in `packages/shared` are the runtime contracts. Export the
schema and infer its TypeScript type instead of maintaining a duplicate
interface. Apply configuration limits in the shared schema so every caller
observes the same rules.

When changing an HTTP response or SSE event:

1. Update or add the shared schema and its boundary-case tests.
2. Parse input and output at the API boundary.
3. Validate successful JSON responses and every SSE event in the web client.
4. Preserve structured error codes so validation, connectivity, conflict,
   timeout, and broker failures remain distinguishable.
5. Update API, client, workflow, and documentation tests as applicable.
6. Consider persisted legacy data and rolling compatibility before making a
   field required.

Never use a TypeScript assertion as a substitute for validating untrusted or
persisted data. Avoid weakening a schema merely to accept an implementation
mistake.

## Database migrations

SQLite schema changes are append-only, versioned migrations in
`apps/api/src/migrations.ts`. For each change:

- Add one migration with the next consecutive integer version and a concise,
  unique name. Never edit an already shipped migration.
- Use SQLite-compatible SQL and constraints that protect the domain invariant.
- Let `migrateDatabase` apply the schema change and `PRAGMA user_version` in
  the same transaction.
- Update typed row mappers and repository operations rather than exposing
  storage-shaped rows to routes.
- Preserve hydration of rows created by earlier application versions. Prefer
  deterministic defaults or read-time derivation when a data rewrite is not
  necessary.
- Define foreign-key and deletion behavior deliberately. History deletion must
  not attempt broker cleanup; broker resources belong to the run lifecycle.
- Add tests for a fresh database, upgrade from the prior version, rollback on
  failure, forward-version rejection, row mapping, and cascade behavior as
  relevant.

Do not inspect or mutate a contributor's normal development database in tests.
Use the test helpers and temporary databases already used by the repository
suite.

## Coding conventions

- Use TypeScript in strict mode and ECMAScript modules.
- Keep application code, identifiers, errors, and public documentation in
  English.
- Prefer small, explicit modules and composition over a generic broker
  superclass.
- Keep async cancellation and cleanup idempotent; retain the original failure
  when reporting a separate cleanup failure.
- Use monotonic time for measured durations and avoid adding setup or cleanup
  work to the timed benchmark interval.
- Do not persist per-message timings or personal host identifiers.
- Add focused tests beside the implementation. Test externally visible
  behavior instead of private implementation details.
- Preserve accessibility: native controls, labels, keyboard operation, focus
  behavior, readable tables, and useful live-region announcements.
- Let Prettier and ESLint define mechanical style. Run `npm run format` to fix
  formatting and review the resulting diff before committing it.

Avoid drive-by refactors in behavior changes. Never commit `.env`, SQLite
databases, build output, coverage output, Playwright reports, or credentials.

## Test matrix

Run the smallest relevant checks while developing, then choose the full set
needed for the risk of the change.

| Command                    | Coverage                                                                        |            Docker required            |
| -------------------------- | ------------------------------------------------------------------------------- | :-----------------------------------: |
| `npm run format:check`     | Markdown, source, and configuration formatting                                  |                  No                   |
| `npm run lint`             | ESLint rules across the repository                                              |                  No                   |
| `npm run typecheck`        | TypeScript project references and all workspaces                                |                  No                   |
| `npm test`                 | Unit, API, repository, migration, component, and workflow tests                 |                  No                   |
| `npm run build`            | Shared/API TypeScript output and production web bundle                          |                  No                   |
| `npm run test:integration` | Real Redis, Kafka, and RabbitMQ adapter and benchmark paths                     | Yes; healthy brokers on default ports |
| `npm run test:e2e`         | Isolated production stack, Playwright workflows, keyboard checks, and Axe scans |                  Yes                  |
| `npm run test:smoke`       | Isolated stack build, default persisted run, API restart, and cleanup           |                  Yes                  |

Before integration tests, start only the brokers if they are not already
available:

```sh
docker compose up --detach --wait redis kafka rabbitmq
npm run test:integration
```

Install Chromium once before the E2E suite with
`npm run test:e2e:install`. The `test:e2e` and `test:smoke` scripts create
uniquely named Compose projects on isolated ports and remove their containers
and volumes afterward. If a test is interrupted, identify its exact Compose
project before removing it; do not delete unrelated Docker resources or the
normal development volumes.

Changes to shared contracts, migrations, scheduling, cancellation, broker
adapters, recovery, exports, or comparison-track logic require focused tests
at each affected boundary. Performance assertions should verify correctness
and broad sanity only; narrow throughput or latency thresholds are not stable
on shared machines.

## Documentation expectations

Update documentation in the same change when behavior, contracts, setup, or
interpretation changes:

- `README.md` for user-visible capabilities and primary navigation.
- `docs/api.md` for endpoints, filters, events, errors, environment variables,
  and examples.
- `docs/architecture.md` for ownership, lifecycle, persistence, and flow
  changes.
- `docs/benchmark-methodology.md` for metrics, workload rules, statistical
  treatment, and interpretation limits.
- `docs/glossary.md` for new messaging or benchmark terminology.
- `docs/adr` for architectural decisions that constrain future work.
- `docs/accessibility.md` when an interaction or verification procedure
  changes.

Examples must be reproducible and must not promise a broker ranking or a fixed
performance result. Keep Kafka-versus-RabbitMQ comparisons scenario-bound,
Redis Streams independently summarized, Redis Pub/Sub explicitly ephemeral,
and recovery/replay observations broker-native. Use official primary sources
for claims about broker behavior.

Update `TODO.md` only after the feature and its appropriate verification are
complete. Keep `PLAN.md` focused on product direction rather than a log of
implementation details.

## Pull request checklist

- [ ] The change is focused and belongs in the workspaces it modifies.
- [ ] Broker-native semantics and comparison-track boundaries remain explicit.
- [ ] Shared Zod schemas and runtime boundary validation cover contract changes.
- [ ] Database changes use a new migration and preserve legacy hydration.
- [ ] Cancellation, timeout, failure, restart, and cleanup paths were considered.
- [ ] Unit, API, repository, component, integration, or E2E tests were added at
      the affected boundaries.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`,
      and `npm run build` pass.
- [ ] Docker-backed integration, E2E, and smoke checks were run when the change
      can affect them.
- [ ] User-facing, API, architecture, methodology, and accessibility
      documentation was updated where needed.
- [ ] No secrets, local databases, generated artifacts, personal identifiers,
      or unrelated changes are included.
- [ ] `git diff --check` passes and the final diff was reviewed.

## Release process

Messaging Lab follows Semantic Versioning and Keep a Changelog. Before
publishing a version:

1. Move relevant entries from `CHANGELOG.md`'s `Unreleased` section into a new
   dated version heading and leave a fresh `Unreleased` section at the top.
2. Update the root, application, and shared-package versions consistently,
   including the lockfile and default provenance version.
3. Run the complete format, lint, type-check, unit, integration, E2E, build, and
   smoke sequence from a clean checkout.
4. Review the release diff, commit it, and create the matching version tag.
5. Publish release notes from the changelog without claiming unverified
   performance improvements.

The current `0.1.0` metadata describes the source tree; the changelog does not
claim that version has already been published.
