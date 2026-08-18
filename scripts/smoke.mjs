import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const projectName = `messaging-lab-smoke-${process.pid}`;
const ports = {
  api: process.env.SMOKE_API_PORT ?? '13000',
  kafka: process.env.SMOKE_KAFKA_PORT ?? '19092',
  rabbitmq: process.env.SMOKE_RABBITMQ_PORT ?? '15673',
  rabbitmqManagement: process.env.SMOKE_RABBITMQ_MANAGEMENT_PORT ?? '25672',
  redis: process.env.SMOKE_REDIS_PORT ?? '16379',
  web: process.env.SMOKE_WEB_PORT ?? '15173',
};
const smokeEnvironment = {
  ...process.env,
  API_PORT: ports.api,
  COMPOSE_PROJECT_NAME: projectName,
  KAFKA_PORT: ports.kafka,
  RABBITMQ_MANAGEMENT_PORT: ports.rabbitmqManagement,
  RABBITMQ_PORT: ports.rabbitmq,
  REDIS_PORT: ports.redis,
  WEB_PORT: ports.web,
};
const composeCommand = findComposeCommand();
const apiUrl = `http://127.0.0.1:${ports.api}`;
const webUrl = `http://127.0.0.1:${ports.web}`;
let failed = false;

try {
  console.log(`Starting isolated smoke stack ${projectName}...`);
  runCompose(['up', '--build', '--detach']);
  await waitForHttp(`${apiUrl}/health`, 240_000);
  await waitForHttp(webUrl, 30_000);

  const brokers = await requestJson(`${apiUrl}/api/brokers`);
  assert(
    Array.isArray(brokers.brokers) && brokers.brokers.length === 3,
    'Expected all three brokers from the API.',
  );
  assert(
    brokers.brokers.every((broker) => broker.health?.status === 'healthy'),
    'Expected Redis, Kafka, and RabbitMQ to be healthy.',
  );

  const benchmarkStartedAt = performance.now();
  const startedRun = await requestJson(`${apiUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ broker: 'redis', scenario: 'fan-out' }),
  });
  const completedRun = await waitForRun(startedRun.id, 150_000);
  const benchmarkWallTimeMs = performance.now() - benchmarkStartedAt;

  assert(
    completedRun.status === 'completed',
    `Run ended as ${completedRun.status}.`,
  );
  assert(
    completedRun.configuration?.messageCount === 10_000,
    'Smoke run did not use the default message count.',
  );
  assert(
    completedRun.metrics?.publishedMessages === 10_000,
    'Default run did not publish 10,000 messages.',
  );
  assert(
    completedRun.metrics?.lostMessages === 0,
    'Default run lost messages.',
  );

  const historyBeforeRestart = await requestJson(
    `${apiUrl}/api/runs?limit=100`,
  );
  assert(
    historyBeforeRestart.runs?.some((run) => run.id === completedRun.id),
    'Completed run was not written to history.',
  );

  console.log('Restarting the API to verify SQLite persistence...');
  runCompose(['restart', 'api']);
  await waitForHttp(`${apiUrl}/health`, 90_000);
  const persistedRun = await requestJson(
    `${apiUrl}/api/runs/${completedRun.id}`,
  );
  assert(
    persistedRun.status === 'completed',
    'Run did not survive the API restart.',
  );
  assert(
    persistedRun.metrics?.publishedMessages === 10_000,
    'Persisted aggregate metrics changed after restart.',
  );

  console.log(
    JSON.stringify(
      {
        result: 'passed',
        runId: completedRun.id,
        defaultMessageCount: completedRun.configuration.messageCount,
        benchmarkElapsedMs: completedRun.metrics.elapsedMs,
        benchmarkWallTimeMs: Number(benchmarkWallTimeMs.toFixed(1)),
        throughputMessagesPerSecond:
          completedRun.metrics.throughputMessagesPerSecond,
        historySurvivedRestart: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.stack : error);
  runCompose(['logs', '--no-color', '--tail', '200'], false);
} finally {
  console.log(`Removing isolated smoke stack ${projectName}...`);
  runCompose(['down', '--volumes', '--remove-orphans'], false);
}

if (failed) process.exitCode = 1;

function findComposeCommand() {
  const candidates = [['docker', 'compose'], ['docker-compose']];
  const command = candidates.find(
    ([executable, ...args]) =>
      spawnSync(executable, [...args, 'version'], { stdio: 'ignore' })
        .status === 0,
  );
  if (!command)
    throw new Error('Docker Compose is required for the smoke test.');
  return command;
}

function runCompose(args, required = true) {
  const [executable, ...baseArgs] = composeCommand;
  const result = spawnSync(executable, [...baseArgs, ...args], {
    env: smokeEnvironment,
    stdio: 'inherit',
  });
  if (required && result.status !== 0) {
    throw new Error(`Docker Compose command failed: ${args.join(' ')}`);
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not ready';

  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function waitForRun(runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const run = await requestJson(`${apiUrl}/api/runs/${runId}`);
    if (
      ['completed', 'failed', 'timed-out', 'cancelled'].includes(run.status)
    ) {
      return run;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

async function requestJson(url, init) {
  const response = await globalThis.fetch(url, {
    ...init,
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON content (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status}: ${body.error?.message ?? text}`,
    );
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
