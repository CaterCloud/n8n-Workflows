/** An HTTP call that came back with a non-2xx status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
    readonly method = 'GET',
  ) {
    super(`${method} ${url} -> ${status}: ${body.slice(0, 500)}`);
    this.name = 'HttpError';
  }

  /** Worth retrying: rate limits, server faults, and request timeouts. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** A workflow refused to run because its configuration is incomplete. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
