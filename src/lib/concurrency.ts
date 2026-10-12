/** Maps over `items` running at most `limit` tasks at once, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

export type Settled<R> = { ok: true; value: R } | { ok: false; error: Error };

/** As `mapLimit`, but captures per-item failures instead of rejecting. */
export async function settleLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<Settled<R>>> {
  return mapLimit(items, limit, async (item, index) => {
    try {
      return { ok: true as const, value: await fn(item, index) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}
