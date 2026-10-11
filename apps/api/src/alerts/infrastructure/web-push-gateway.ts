import webPush, { WebPushError } from 'web-push';

import type { VapidConfig } from '../../config.js';
import type { PushEndpoint } from '../application/subscription-ports.js';
import type { PushGateway, PushOptions } from '../application/push-ports.js';

/** The `web-push` send function (replaced in tests). */
export type SendNotification = (
  ...args: Parameters<typeof webPush.sendNotification>
) => Promise<Pick<webPush.SendResult, 'statusCode'>>;

export interface WebPushGatewayOptions {
  /**
   * Socket timeout for one push request. Push services answer in well under a second; a short
   * timeout keeps a stuck service from holding an alert's dispatch (and shutdown) for long.
   */
  readonly timeoutMs?: number;
  readonly sendNotification?: SendNotification;
}

export const DEFAULT_PUSH_TIMEOUT_MS = 5_000;

/** The Web Push protocol (RFC 8030, VAPID, aes128gcm payload encryption) through `web-push`. */
export class WebPushGateway implements PushGateway {
  private readonly timeoutMs: number;
  private readonly sendNotification: SendNotification;

  constructor(
    private readonly vapid: VapidConfig,
    options: WebPushGatewayOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS;
    this.sendNotification = options.sendNotification ?? webPush.sendNotification;
  }

  async send(
    target: PushEndpoint,
    payload: string,
    options: PushOptions,
  ): Promise<{ httpStatus: number }> {
    try {
      const result = await this.sendNotification(
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
      // The push service answered with an error status (404/410 gone, 429, 5xx, ...). Anything
      // else (network error, timeout, invalid keys) means no answer: the caller sees a rejection.
      if (error instanceof WebPushError) return { httpStatus: error.statusCode };
      throw error;
    }
  }
}
