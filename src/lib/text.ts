/** Small string helpers ported verbatim in behaviour from the n8n code nodes. */

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Removes emoji from captions. GoHighLevel's Google Business Profile channel
 * rejects them, which is why the original workflow stripped them globally.
 */
export function stripEmojis(input: unknown): string {
  return safeString(input).replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu, '');
}

export function baseNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.split('/').pop() || 'post';
  } catch {
    return 'post';
  }
}

export function extensionOf(nameOrUrl: string): string {
  const match = safeString(nameOrUrl).toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  return match?.[1] ?? '';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** Defaults to image/jpeg, as the n8n helper did. */
export function mimeFromNameOrUrl(nameOrUrl: string): string {
  return MIME_BY_EXT[extensionOf(nameOrUrl)] ?? 'image/jpeg';
}

/**
 * Pulls a JSON object out of a model response, tolerating ```json fences and
 * surrounding prose.
 */
export function parseJsonLoose<T = unknown>(raw: string): T | undefined {
  const cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  const attempt = (text: string): T | undefined => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  };

  const direct = attempt(cleaned);
  if (direct !== undefined) return direct;

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) return attempt(cleaned.slice(start, end + 1));
  return undefined;
}

/** Fisher-Yates, then take the first `n`. */
export function pickRandom<T>(items: readonly T[], n: number, random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, n);
}

/** Reads `a.b.c` / `a.b['c d']` style paths out of a webhook payload. */
export function getPath(source: unknown, path: string): unknown {
  const keys = path
    .replace(/\[(['"]?)(.*?)\1\]/g, '.$2')
    .split('.')
    .filter(Boolean);

  let current: unknown = source;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
