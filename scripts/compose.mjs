import { spawnSync } from 'node:child_process';

const candidates = [['docker', 'compose'], ['docker-compose']];

const composeCommand = candidates.find(([command, ...args]) => {
  const result = spawnSync(command, [...args, 'version'], { stdio: 'ignore' });
  return result.status === 0;
});

if (!composeCommand) {
  console.error(
    'Docker Compose is required. Install the Docker Compose plugin or standalone binary.',
  );
  process.exit(1);
}

const [command, ...composeArgs] = composeCommand;
const result = spawnSync(command, [...composeArgs, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
