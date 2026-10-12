/** A workflow refused to run because its configuration is incomplete. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** The webhook payload lacked the value needed to find a row. */
export class MissingMatchValueError extends Error {
  constructor(readonly column: string) {
    super(`Webhook payload has no ${column} value to match on`);
    this.name = 'MissingMatchValueError';
  }
}

/**
 * Pulls a status and a safe message out of a googleapis error.
 *
 * Gaxios errors carry the failing request on them, so they are never echoed
 * wholesale — only the status and Google's own message string are surfaced.
 */
export function describeGoogleError(err: unknown): { status: number; message: string } | undefined {
  if (typeof err !== 'object' || err === null) return undefined;

  const candidate = err as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: { error?: { message?: unknown } } };
  };

  const rawStatus = candidate.response?.status ?? candidate.status ?? candidate.code;
  const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
  if (!Number.isInteger(status) || status < 400 || status > 599) return undefined;

  const googleMessage = candidate.response?.data?.error?.message;
  const message =
    typeof googleMessage === 'string'
      ? googleMessage
      : typeof candidate.message === 'string'
        ? candidate.message
        : 'Google API request failed';

  return { status, message };
}
