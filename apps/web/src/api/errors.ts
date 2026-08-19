export type ApiErrorKind =
  | 'validation'
  | 'connectivity'
  | 'conflict'
  | 'timeout'
  | 'broker'
  | 'server';

export class ApiClientError extends Error {
  public constructor(
    public readonly kind: ApiErrorKind,
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiClientError';
  }
}

export function responseValidationError(error: unknown): ApiClientError {
  const issue = extractFirstIssue(error);
  const message = `The API returned an invalid response${issue ? `: ${issue}` : ''}.`;
  return new ApiClientError(
    'validation',
    'INVALID_API_RESPONSE',
    message,
    null,
    undefined,
    { cause: error },
  );
}

function extractFirstIssue(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('issues' in error)) return null;
  const issues = error.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const first = issues[0];
  return first &&
    typeof first === 'object' &&
    'message' in first &&
    typeof first.message === 'string'
    ? first.message
    : null;
}

export function classifyServerError(
  status: number,
  code: string,
): ApiErrorKind {
  if (status === 409) return 'conflict';
  if (status === 408 || status === 504 || code.includes('TIMEOUT')) {
    return 'timeout';
  }
  if (code.includes('BROKER') || code.includes('UNAVAILABLE')) return 'broker';
  return 'server';
}
