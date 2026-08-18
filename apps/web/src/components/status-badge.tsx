import type { RunStatus } from '@messaging-lab/shared';

import { STATUS_LABELS } from '../format.js';

export function StatusBadge({ status }: { readonly status: RunStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
