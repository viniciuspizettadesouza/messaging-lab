import { describe, expect, it } from 'vitest';

import { workspaceNames } from './index.js';

describe('workspaceNames', () => {
  it('uses the shared workspace namespace', () => {
    expect(Object.values(workspaceNames)).toEqual([
      '@messaging-lab/api',
      '@messaging-lab/shared',
      '@messaging-lab/web',
    ]);
  });
});
