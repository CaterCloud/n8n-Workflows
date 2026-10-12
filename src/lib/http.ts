import { env } from '../env.js';
import { logger as rootLogger, type Logger } from '../logger.js';
import { HttpError } from './errors.js';

export interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  /** Number of *extra* attempts after the first. */
  retries?: number;
  logger?: Logger;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, capped, and overridden by Retry-After. */
function backoffMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 60_000));
  }
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base + Math.floor(Math.random() * 250);
}

/**
 * fetch with a timeout, bounded retries on transient failures, and a single
 * place to log every outbound call. Returns the raw Response.
 */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = env().HTTP_TIMEOUT_MS, retries = env().HTTP_MAX_RETRIES, logger = rootLogger, ...init } = options;
  const method = init.method ?? 'GET';
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return res;

      const body = await res.text().catch(() => '');
      const error = new HttpError(res.status, url, body, method);
      if (!error.retryable || attempt === retries) throw error;

      const wait = backoffMs(attempt, res.headers.get('retry-after'));
      logger.warn('http retrying', { url, method, status: res.status, attempt: attempt + 1, waitMs: wait });
      await sleep(wait);
      lastError = error;
    } catch (err) {
      if (err instanceof HttpError) {
        if (!err.retryable || attempt === retries) throw err;
        lastError = err;
      } else {
        // Network error or abort.
        if (attempt === retries) throw err;
        const wait = backoffMs(attempt);
        logger.warn('http retrying after network error', {
          url,
          method,
          attempt: attempt + 1,
          waitMs: wait,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(wait);
        lastError = err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`request to ${url} failed`);
}

export async function requestJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(url, options);
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${url} but received: ${text.slice(0, 300)}`);
  }
}

export async function requestBuffer(url: string, options: RequestOptions = {}): Promise<Buffer> {
  const res = await request(url, options);
  return Buffer.from(await res.arrayBuffer());
}
