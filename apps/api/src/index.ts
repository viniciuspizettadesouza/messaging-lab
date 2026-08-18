import { createServer } from 'node:http';

import { workspaceNames } from '@messaging-lab/shared';

export const apiWorkspace = workspaceNames.api;

const host = process.env.API_HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.API_PORT ?? '3000', 10);

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, host, () => {
  console.log(`${apiWorkspace} listening on http://${host}:${port}`);
});
