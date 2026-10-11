import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createSubscriptionStore } from './subscription-store';

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
