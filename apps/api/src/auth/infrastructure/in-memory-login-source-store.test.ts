import { describe, expect, it } from 'vitest';

import { InMemoryLoginSourceStore } from './in-memory-login-source-store.js';

const T0 = new Date('2026-10-20T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const counting = { failedAttempts: 1, lockedUntil: null };
const paused = { failedAttempts: 0, lockedUntil: minutes(15) };

describe('InMemoryLoginSourceStore', () => {
  it('keeps nothing for a clean state', async () => {
    const store = new InMemoryLoginSourceStore(() => T0);

    await store.modify('a', () => counting);
    await store.modify('a', () => ({ failedAttempts: 0, lockedUntil: null }));

    expect(store.size).toBe(0);
    expect(await store.find('a')).toEqual({ failedAttempts: 0, lockedUntil: null });
  });

  it('forgets the least recently changed count when full', async () => {
    const store = new InMemoryLoginSourceStore(() => T0, 2);

    await store.modify('a', () => counting);
    await store.modify('b', () => counting);
    await store.modify('c', () => counting);

    expect(store.size).toBe(2);
    expect((await store.find('a')).failedAttempts).toBe(0);
    expect((await store.find('c')).failedAttempts).toBe(1);
  });

  it('never forgets a pause that is still running, even when it is the oldest entry', async () => {
    const store = new InMemoryLoginSourceStore(() => T0, 2);

    await store.modify('paused', () => paused);
    await store.modify('b', () => counting);
    await store.modify('c', () => counting);

    expect(await store.find('paused')).toEqual(paused);
    expect((await store.find('b')).failedAttempts).toBe(0);
    expect(store.size).toBe(2);
  });

  it('keeps no new count while every entry is a running pause, and frees room once they end', async () => {
    let now = T0;
    const store = new InMemoryLoginSourceStore(() => now, 2);
    await store.modify('p1', () => paused);
    await store.modify('p2', () => paused);

    await store.modify('new', () => counting);
    expect(store.size).toBe(2);
    expect(await store.find('p1')).toEqual(paused);
    expect((await store.find('new')).failedAttempts).toBe(0);

    now = minutes(16);
    await store.modify('new', () => counting);
    expect((await store.find('new')).failedAttempts).toBe(1);
    expect(store.size).toBe(2);
  });
});
