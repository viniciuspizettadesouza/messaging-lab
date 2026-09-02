# Publish Complete Project Documentation

## Summary

Complete every remaining publication-quality checklist item without changing
runtime behavior or public API contracts. Add contributor and user guidance,
document architectural decisions and persistence internals, refresh the
dashboard overview, establish a Keep a Changelog workflow, validate all
documentation against semantic comparison boundaries, and run the entire
project verification suite from a fresh temporary source tree.

Suggested commit:

```text
docs: publish experiment, architecture, and contributor guidance
```

## Documentation changes

- Add `CONTRIBUTING.md` covering prerequisites, workspace responsibilities,
  architecture boundaries, shared Zod contract rules, migration conventions,
  coding style, the complete test matrix, documentation expectations, and a
  pull-request checklist.
- Add the following user guides and link them from the README:
  - `docs/experiment-recipes.md`: reproducible durable fan-out,
    competing-consumer sweep, Redis Streams, Redis Pub/Sub loss,
    recovery/replay, and slow-consumer recipes. Each recipe specifies inputs,
    comparison track, expected observations, cleanup, and interpretation
    cautions—never expected rankings or throughput thresholds.
  - `docs/interpreting-results.md`: track compatibility,
    medians/quartiles/IQR, low-sample warnings, outliers, failed trials,
    delivery anomalies, ordering scopes, application-observed backlog,
    environment provenance, exports, and a decision checklist.
  - `docs/troubleshooting.md`: Docker health, port conflicts, broker startup,
    source-mode URLs, SSE reconnect behavior, SQLite migration/version errors,
    Playwright installation, and safely scoped orphan cleanup.
- Add ADR 0002, dated 2026-09-03, recording that runs execute serially, suites
  are server-managed and reserve the run lane through cooldowns, order is
  persisted before execution, browser disconnects do not stop suites, and API
  restarts stop rather than resume active suites. Record rejected browser-owned
  and concurrent scheduling alternatives.
- Add `CHANGELOG.md` using Keep a Changelog categories and an `Unreleased`
  section. Document in `CONTRIBUTING.md` that releases move those entries into
  a dated semantic version, update all package versions consistently, verify
  the complete suite, tag the commit, and start a fresh `Unreleased` section.
  Do not claim that `0.1.0` has already been published.

## Existing documentation and visuals

- Expand architecture documentation with:
  - Run and suite repositories, separate run/suite event stores, recovery
    engine, and SQLite relationships in the topology.
  - A suite sequence showing persisted order, serial trials, cooldown,
    reconnect, cancellation, and terminal state.
  - A recovery-flow diagram distinguishing Redis pending recovery/replay, Kafka
    offset recovery/reset, RabbitMQ redelivery, and Redis Pub/Sub loss.
  - A migration catalog for schema versions 1–6, transactional
    `PRAGMA user_version` behavior, forward-version rejection, startup recovery,
    cascading deletion, and rules for future migrations.
- Cross-check README, API, methodology, glossary, architecture, both ADRs, and
  guides against ADR 0001. Keep Kafka/RabbitMQ comparisons scenario-bound,
  Redis Streams independently summarized, Redis Pub/Sub ephemeral, recovery
  separate from performance rankings, and mixed-track selections free of
  shared winners or aggregates. Validate and normalize official Kafka,
  RabbitMQ, and Redis source links.
- Clarify the existing suite endpoints, filters, exports, run and suite SSE
  event types, replay/reconnect behavior, heartbeats, terminal closure,
  migration lifecycle, and privacy-conscious environment snapshot fields. No
  wire formats or runtime schemas change.
- Replace `docs/images/dashboard.png` with one 1440-pixel-wide full-page
  overview captured from the production Compose stack. Populate a named, small
  rotating suite spanning current comparison tracks and a recovery result so
  the image shows the current suite controls, progress/results, history, track
  separation, recovery UI, and capability content. Use fixed workload inputs
  and names; treat machine-dependent measurements as illustrative only.
- Update TODO and plan status only after documentation and verification succeed.

## Verification

- Validate all relative Markdown links and confirm external evidence links
  resolve to authoritative official sources.
- Run Prettier checking, ESLint, TypeScript checking, all unit/component/API
  tests, and the production build.
- Start healthy Redis, Kafka, and RabbitMQ containers and run the complete
  integration suite, then stop only that scoped Compose project.
- Run the isolated Playwright E2E suite and isolated smoke test, confirming both
  remove their containers and volumes.
- Repeat the complete command sequence from a fresh temporary copy containing
  only project sources and the intended changes, with a new `npm ci` and no
  inherited `node_modules`, build output, database, or test artifacts.
- Resolve any discovered documentation, configuration, or test failure without
  expanding runtime product scope; rerun the affected check and then the
  complete sequence.
- Finish with `git diff --check`, a clean artifact audit, and all
  publication-quality TODO items checked.

## Interfaces and assumptions

- No HTTP endpoints, schemas, migrations, package dependencies, or application
  behavior are added or changed.
- Keep a Changelog is the selected release-note process.
- A single refreshed full-page overview replaces the stale screenshot; no
  additional focused images are added.
- Later fault-injection, multi-host, import, and additional-broker ideas remain
  out of scope.
