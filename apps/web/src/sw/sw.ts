/**
 * Service worker of the citizen PWA (built by vite-plugin-pwa, `injectManifest` strategy):
 * precaches the app shell for offline starts, shows proximity alerts and confirms their receipt.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { parseAlertPayload } from '../citizen/push/alert-notification';
import { createSubscriptionStore } from '../citizen/push/subscription-store';
import { handleAlertPush, openAlertPage } from './push-handlers';

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Pages (`/`, `/panel`) start from the cached shell; the API is never served from the cache.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const store = createSubscriptionStore(self.indexedDB);

self.addEventListener('push', (event) => {
  event.waitUntil(
    handleAlertPush(readPushData(event.data), {
      showNotification: (title, options) => self.registration.showNotification(title, options),
      loadSubscription: () => store.load(),
      fetch: (input, init) => self.fetch(input, init),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url } = parseAlertPayload(event.notification.data);
  event.waitUntil(openAlertPage(url, self.clients, self.location.origin));
});

function readPushData(data: PushMessageData | null): unknown {
  if (data === null) return null;
  try {
    return data.json();
  } catch {
    return { body: data.text() };
  }
}
