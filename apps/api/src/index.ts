import { createApplication } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = createApplication({ config });
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down API');

  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ err: error }, 'API shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, 'API startup failed');
  await app.close();
  process.exitCode = 1;
}
