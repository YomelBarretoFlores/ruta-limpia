import type { CitizenApi } from '../api/citizen-api';
import { createPushService, type PushService } from './push-service';
import { browserPushCapabilities, detectPushSupport } from './push-support';
import {
  createSubscriptionStore,
  type StoredSubscription,
  type SubscriptionStore,
} from './subscription-store';

/** The subscription store of this browser (in memory when IndexedDB is blocked). */
export function createBrowserSubscriptionStore(): SubscriptionStore {
  if (typeof indexedDB !== 'undefined') return createSubscriptionStore(indexedDB);
  let current: StoredSubscription | null = null;
  return {
    load: () => Promise.resolve(current),
    save: (subscription) => {
      current = subscription;
      return Promise.resolve();
    },
    clear: () => {
      current = null;
      return Promise.resolve();
    },
  };
}

/** Waits for the active service worker (registered in `main.tsx`), at most `timeoutMs`. */
async function readyRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Service worker not ready')), timeoutMs);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createBrowserPushService(api: CitizenApi, store: SubscriptionStore): PushService {
  return createPushService({
    api,
    store,
    support: () => detectPushSupport(browserPushCapabilities()),
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => (await readyRegistration()).pushManager,
  });
}
