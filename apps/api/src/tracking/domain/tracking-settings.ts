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
  /** A point counts as passed once progress is within this distance before it. */
  readonly passToleranceMeters: number;
  /** The trip completes once progress is within this distance of the route end. */
  readonly endToleranceMeters: number;
  /** A trip without fixes for this long is inactive (the application layer aborts it). */
  readonly inactivityTimeoutSec: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = Object.freeze({
  offRouteThresholdMeters: 60,
  backToleranceMeters: 30,
  maxPlausibleSpeedMps: 15,
  advanceSlackMeters: 50,
  passToleranceMeters: 15,
  endToleranceMeters: 30,
  inactivityTimeoutSec: 30 * 60,
});
