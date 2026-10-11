import type { DeliveryStatus } from '../domain/push-delivery.js';
import type { PushEndpoint, RevokeReason } from './subscription-ports.js';

/** An active subscription to push to. */
export interface PushTarget extends PushEndpoint {
  readonly subscriptionId: string;
}

export interface PushOptions {
  readonly ttlSeconds: number;
  readonly urgency: 'high';
  readonly topic: string;
}

/**
 * Port: the Web Push protocol client. Resolves with the push service's HTTP status, also for error
 * statuses (404, 410, 429, 5xx); rejects only when no answer was received (network, timeout,
 * invalid keys).
 */
export interface PushGateway {
  send(
    target: PushEndpoint,
    payload: string,
    options: PushOptions,
  ): Promise<{ readonly httpStatus: number }>;
}

export interface NewDelivery {
  readonly alertId: string;
  readonly subscriptionId: string;
  readonly status: DeliveryStatus;
  readonly httpStatus: number | null;
  readonly sentAt: Date;
}

export interface DeliveryCounts {
  readonly recipients: number;
  readonly delivered: number;
  readonly failed: number;
}

/** Port: subscriptions to deliver to and the delivery log. */
export interface AlertDeliveryStore {
  activeTargets(pointId: string): Promise<PushTarget[]>;
  /** Records the outcome; a second record for the same (alert, subscription) is ignored. */
  recordDelivery(delivery: NewDelivery): Promise<void>;
  /** Resets the failure streak after a successful push. */
  markSuccess(subscriptionId: string, at: Date): Promise<void>;
  /**
   * Counts one more failure in a row and revokes the subscription (`too_many_failures`) when the
   * streak reaches `maxConsecutiveFailures`. Returns true when it was revoked now.
   */
  markFailure(subscriptionId: string, maxConsecutiveFailures: number, at: Date): Promise<boolean>;
  revoke(subscriptionId: string, reason: RevokeReason, at: Date): Promise<void>;
  /** Recomputes the alert's recipients/delivered/failed counts from its deliveries. */
  refreshAlertCounts(alertId: string): Promise<DeliveryCounts>;
}
