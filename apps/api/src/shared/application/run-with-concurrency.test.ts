import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from './run-with-concurrency.js';

describe('runWithConcurrency', () => {
  it('processes every item with at most `limit` running at once', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      done.push(item);
      running--;
    });

    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('runs every item before rethrowing failures', async () => {
    const done: number[] = [];

    await expect(
      runWithConcurrency([1, 2, 3], 2, (item) => {
        done.push(item);
        return item === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(done).toEqual([1, 2, 3]);
  });

  it('does nothing for an empty list', async () => {
    await expect(runWithConcurrency([], 4, () => Promise.resolve())).resolves.toBeUndefined();
  });
});
