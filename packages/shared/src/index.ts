export * from './api.js';
export * from './broker-adapter.js';
export * from './capabilities.js';
export * from './configuration.js';
export * from './domain.js';

export const workspaceNames = {
  api: '@messaging-lab/api',
  shared: '@messaging-lab/shared',
  web: '@messaging-lab/web',
} as const;
