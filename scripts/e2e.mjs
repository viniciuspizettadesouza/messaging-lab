import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const projectName = `messaging-lab-e2e-${process.pid}`;
const ports = {
  api: process.env.E2E_API_PORT ?? '23000',
  kafka: process.env.E2E_KAFKA_PORT ?? '29092',
  rabbitmq: process.env.E2E_RABBITMQ_PORT ?? '25673',
  rabbitmqManagement: process.env.E2E_RABBITMQ_MANAGEMENT_PORT ?? '35672',
  redis: process.env.E2E_REDIS_PORT ?? '26379',
  web: process.env.E2E_WEB_PORT ?? '25173',
};
const e2eEnvironment = {
  ...process.env,
  API_PORT: ports.api,
  COMPOSE_PROJECT_NAME: projectName,
  E2E_BASE_URL: `http://127.0.0.1:${ports.web}`,
  KAFKA_PORT: ports.kafka,
  RABBITMQ_MANAGEMENT_PORT: ports.rabbitmqManagement,
  RABBITMQ_PORT: ports.rabbitmq,
  REDIS_PORT: ports.redis,
  WEB_PORT: ports.web,
};
const composeCommand = findComposeCommand();
let failed = false;

try {
  console.log(`Starting isolated E2E stack ${projectName}...`);
  runCompose(['up', '--build', '--detach']);
  await waitForHttp(`http://127.0.0.1:${ports.api}/health`, 240_000);
  await waitForHttp(e2eEnvironment.E2E_BASE_URL, 30_000);
  run('npm', ['exec', '--', 'playwright', 'test']);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.stack : error);
  runCompose(['logs', '--no-color', '--tail', '200'], false);
} finally {
  console.log(`Removing isolated E2E stack ${projectName}...`);
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
  if (!command) throw new Error('Docker Compose is required for E2E tests.');
  return command;
}

function runCompose(args, required = true) {
  const [executable, ...baseArgs] = composeCommand;
  return run(executable, [...baseArgs, ...args], required);
}

function run(executable, args, required = true) {
  const result = spawnSync(executable, args, {
    env: e2eEnvironment,
    stdio: 'inherit',
  });
  if (required && result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed.`);
  }
  return result;
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
