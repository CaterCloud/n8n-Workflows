import { describe, expect, it } from 'vitest';
import { withLock } from '../src/lib/mutex.js';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('withLock', () => {
  it('serialises same-key work so a read/append pair cannot interleave', async () => {
    const trace: string[] = [];

    const task = (name: string, delay: number) =>
      withLock('sheet', async () => {
        trace.push(`${name}:start`);
        await tick(delay);
        trace.push(`${name}:end`);
      });

    await Promise.all([task('a', 20), task('b', 1), task('c', 1)]);

    expect(trace).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('runs different keys concurrently', async () => {
    const trace: string[] = [];
    await Promise.all([
      withLock('one', async () => {
        trace.push('one:start');
        await tick(15);
        trace.push('one:end');
      }),
      withLock('two', async () => {
        trace.push('two:start');
        await tick(1);
        trace.push('two:end');
      }),
    ]);

    expect(trace).toEqual(['one:start', 'two:start', 'two:end', 'one:end']);
  });

  it('propagates a failure to its own caller only, and keeps the queue moving', async () => {
    const failing = withLock('sheet', async () => {
      throw new Error('boom');
    });
    const following = withLock('sheet', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('ok');
  });

  it('returns the callback value', async () => {
    await expect(withLock('k', async () => 42)).resolves.toBe(42);
  });
});
