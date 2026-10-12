/**
 * A minimal FIFO mutex, keyed by an arbitrary string.
 *
 * The lead tracker reads the sheet, decides update-or-append, then writes. Two
 * webhooks arriving together for the same new email would both read "no row"
 * and both append, producing duplicates. Serialising per spreadsheet removes
 * that window.
 *
 * This is process-local: it holds for a single Railway instance. Running more
 * than one replica needs a shared lock instead — see docs/ARCHITECTURE.md.
 */

const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn);

  // Keep the chain alive but swallow rejections so one failure does not poison
  // every later waiter.
  const link = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, link);

  void link.then(() => {
    if (chains.get(key) === link) chains.delete(key);
  });

  return result;
}
