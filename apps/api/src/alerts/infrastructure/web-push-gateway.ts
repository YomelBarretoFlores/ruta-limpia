import webPush, { WebPushError } from 'web-push';

import type { VapidConfig } from '../../config.js';
import type { PushEndpoint } from '../application/subscription-ports.js';
import type { PushGateway, PushOptions } from '../application/push-ports.js';

/** The Web Push protocol (RFC 8030, VAPID, aes128gcm payload encryption) through `web-push`. */
export class WebPushGateway implements PushGateway {
  constructor(
    private readonly vapid: VapidConfig,
    /** Socket timeout for one push request. */
    private readonly timeoutMs = 10_000,
  ) {}

  async send(
    target: PushEndpoint,
    payload: string,
    options: PushOptions,
  ): Promise<{ httpStatus: number }> {
    try {
      const result = await webPush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          TTL: options.ttlSeconds,
          urgency: options.urgency,
          topic: options.topic,
          timeout: this.timeoutMs,
          vapidDetails: {
            subject: this.vapid.subject,
            publicKey: this.vapid.publicKey,
            privateKey: this.vapid.privateKey,
          },
        },
      );
      return { httpStatus: result.statusCode };
    } catch (error) {
      // The push service answered with an error status (404/410 gone, 429, 5xx, ...).
      if (error instanceof WebPushError) return { httpStatus: error.statusCode };
      throw error;
    }
  }
}
