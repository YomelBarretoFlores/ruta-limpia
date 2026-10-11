/** Outcome of one push to one subscription, as recorded in `alert_deliveries`. */
export type DeliveryStatus = 'sent' | 'failed' | 'expired';

export interface PushDeliverySettings {
  /** Pushes sent at the same time for one alert. */
  readonly concurrency: number;
  /** A subscription is revoked after this many failed pushes in a row. */
  readonly maxConsecutiveFailures: number;
  /** Push services keep an undelivered message at least this long. */
  readonly minTtlSeconds: number;
}

export const DEFAULT_PUSH_DELIVERY_SETTINGS: PushDeliverySettings = Object.freeze({
  concurrency: 8,
  maxConsecutiveFailures: 5,
  minTtlSeconds: 60,
});

/**
 * Classifies the push service's answer: 2xx is sent; 404 and 410 mean the browser subscription no
 * longer exists (expired, it is revoked); anything else, or no answer at all (null), is a failure.
 */
export function classifyPushResponse(httpStatus: number | null): DeliveryStatus {
  if (httpStatus === null) return 'failed';
  if (httpStatus >= 200 && httpStatus < 300) return 'sent';
  if (httpStatus === 404 || httpStatus === 410) return 'expired';
  return 'failed';
}

/** An alert is useless after the truck passes: keep it until then, but at least `minTtlSeconds`. */
export function pushTtlSeconds(
  secondsRemaining: number,
  minTtlSeconds = DEFAULT_PUSH_DELIVERY_SETTINGS.minTtlSeconds,
): number {
  return Math.max(minTtlSeconds, Math.round(secondsRemaining));
}

/**
 * Push topic per point (URL-safe, at most 32 characters): a newer alert for the same point replaces
 * an undelivered older one on the push service.
 */
export function pushTopic(pointCode: string): string {
  return `ruta-limpia-${pointCode.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 32);
}
