/** Tunables for trip progress, pass detection and the trip lifecycle. */
export interface TrackingSettings {
  /** A fix farther than this from the route line is off route and does not move progress. */
  readonly offRouteThresholdMeters: number;
  /** How far behind the current progress a fix may still match (GPS jitter). */
  readonly backToleranceMeters: number;
  /** Fastest plausible truck speed; bounds how far progress may advance between fixes. */
  readonly maxPlausibleSpeedMps: number;
  /** Extra distance added to the plausible advance to absorb GPS noise. */
  readonly advanceSlackMeters: number;
  /**
   * The trip completes once progress is within this distance of the route end. Points still ahead in
   * that final stretch are then passed at the completing fix (`upper_bound` precision).
   */
  readonly endToleranceMeters: number;
  /** A trip without fixes for this long is inactive (the application layer aborts it). */
  readonly inactivityTimeoutSec: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = Object.freeze({
  offRouteThresholdMeters: 60,
  backToleranceMeters: 30,
  maxPlausibleSpeedMps: 15,
  advanceSlackMeters: 50,
  endToleranceMeters: 30,
  inactivityTimeoutSec: 30 * 60,
});
