import webPush from 'web-push';

import type { ApiConfig } from '../../src/composition-root.js';

const vapid = webPush.generateVAPIDKeys();

/** API configuration for integration tests: push enabled with throwaway VAPID keys. */
export const TEST_API_CONFIG: ApiConfig = {
  ingestToken: 'integration-ingest-token-0123456789abcdef',
  tripStartZoneMeters: 150,
  tripInactivityTimeoutSec: 1800,
  tripInactivityCheckIntervalSec: 60,
  trustProxy: false,
  publicRateLimitPerMinute: 1000,
  pushConcurrency: 4,
  pushMaxConsecutiveFailures: 5,
  vapid: { ...vapid, subject: 'mailto:integration@example.org' },
};

/** A browser-like `PushSubscription.toJSON()` on the FCM endpoint, with valid-length keys. */
export function browserSubscription(device: string) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
    expirationTime: null,
    keys: {
      p256dh: `B${'A'.repeat(86)}`,
      auth: 'AAAAAAAAAAAAAAAAAAAAAA',
    },
  };
}
