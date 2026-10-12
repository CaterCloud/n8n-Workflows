import { env } from '../env.js';

/**
 * An opt-in, in-memory ring buffer of recently received webhook payloads, for
 * working out what an upstream system actually sends.
 *
 * Off unless WEBHOOK_CAPTURE is set. Nothing is written to disk, the buffer is
 * small and bounded, and it is lost on restart or redeploy. While it is on it
 * holds real lead data, so it is admin-gated and meant to be switched off once
 * a mapping question is settled.
 */

export interface CapturedRequest {
  at: string;
  event: string;
  path: string;
  body: unknown;
}

const MAX = 5;
const buffer: CapturedRequest[] = [];

export function captureEnabled(): boolean {
  return env().WEBHOOK_CAPTURE;
}

export function capture(entry: CapturedRequest): void {
  if (!captureEnabled()) return;
  buffer.push(entry);
  while (buffer.length > MAX) buffer.shift();
}

export function recentCaptures(): CapturedRequest[] {
  return [...buffer];
}

export function clearCaptures(): void {
  buffer.length = 0;
}

/**
 * Every dotted path in an object, with each leaf's type and a short preview.
 * This is what makes a payload's real shape obvious at a glance.
 */
export function describeShape(value: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;

  if (Array.isArray(value)) {
    out.push(`${prefix || '(root)'} : array[${value.length}]`);
    if (value.length > 0) describeShape(value[0], `${prefix}[0]`, out, depth + 1);
    return out;
  }

  if (value !== null && typeof value === 'object') {
    if (prefix) out.push(`${prefix} : object`);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Quote keys that would not survive a bare dotted path.
      const safe = /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `['${key}']`;
      describeShape(child, `${prefix}${safe}`, out, depth + 1);
    }
    return out;
  }

  const preview =
    typeof value === 'string'
      ? JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value)
      : String(value);
  out.push(`${prefix || '(root)'} : ${value === null ? 'null' : typeof value} = ${preview}`);
  return out;
}
