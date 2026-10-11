import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createSubscriptionStore, withMemoryFallback } from './subscription-store';

const subscription = {
  subscriptionId: 'sub-1',
  managementToken: 'token-1',
  pointCode: 'P08',
  routeCode: 'RI-01',
};

describe('createSubscriptionStore (IndexedDB)', () => {
  it('saves, reads back and clears the subscription', async () => {
    const factory = new IDBFactory();
    const store = createSubscriptionStore(factory);

    expect(await store.load()).toBeNull();
    await store.save(subscription);
    // Another context (the service worker) opening the same database sees it.
    expect(await createSubscriptionStore(factory).load()).toEqual(subscription);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

/** An IndexedDB whose `open` always fails (blocked storage, some private modes). */
function brokenFactory(): IDBFactory {
  return {
    open: () => {
      const request = {} as { onerror: ((event: Event) => void) | null; error: null };
      request.error = null;
      setTimeout(() => request.onerror?.(new Event('error')));
      return request;
    },
  } as unknown as IDBFactory;
}

describe('withMemoryFallback', () => {
  it('uses IndexedDB while it works, and says so', async () => {
    const store = withMemoryFallback(createSubscriptionStore(new IDBFactory()));

    await store.save(subscription);

    expect(await store.load()).toEqual(subscription);
    expect(store.durable?.()).toBe(true);
  });

  it('keeps the subscription in memory when IndexedDB cannot be opened, and says it is not durable', async () => {
    const store = withMemoryFallback(createSubscriptionStore(brokenFactory()));

    await store.save(subscription);

    expect(await store.load()).toEqual(subscription);
    expect(store.durable?.()).toBe(false);
    await store.clear().catch(() => undefined);
    await expect(store.load()).rejects.toThrow();
  });

  it('does not pretend there is no subscription when IndexedDB fails and memory holds nothing', async () => {
    const store = withMemoryFallback(createSubscriptionStore(brokenFactory()));

    await expect(store.load()).rejects.toThrow();
  });
});
