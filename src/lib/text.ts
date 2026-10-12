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
