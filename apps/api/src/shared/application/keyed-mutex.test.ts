import { describe, expect, it } from 'vitest';

import { KeyedMutex } from './keyed-mutex.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('KeyedMutex', () => {
  it('runs work for the same key one at a time, in call order', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      mutex.runExclusive('truck-1', task('a')),
      mutex.runExclusive('truck-1', task('b')),
      mutex.runExclusive('truck-1', task('c')),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };

    await Promise.all([mutex.runExclusive('a', task('a')), mutex.runExclusive('b', task('b'))]);

    expect(log.slice(0, 2)).toEqual(['a:start', 'b:start']);
  });

  it('keeps the queue going after a failure and releases idle keys', async () => {
    const mutex = new KeyedMutex();

    const failed = mutex.runExclusive('k', () => Promise.reject(new Error('boom')));
    const next = mutex.runExclusive('k', () => Promise.resolve('ok'));

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    expect(mutex.activeKeys).toBe(0);
  });
});
