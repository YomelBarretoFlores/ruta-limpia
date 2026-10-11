/** Tunables for telemetry freshness, speed estimation and ETA prediction. */
export interface EtaSettings {
  /** Telemetry older than this is stale: the ETA is suspended ("sin actualización"). */
  readonly maxFixAgeSec: number;
  /** Effective speeds are clamped to this range (garbage trucks crawl and stop often). */
  readonly minSpeedMps: number;
  readonly maxSpeedMps: number;
  /** Time constant of the recent-speed EWMA: older observations fade with exp(-dt / tau). */
  readonly recentSpeedTimeConstantSec: number;
  /** Length of a historical speed-profile bucket along the route. */
  readonly bucketLengthMeters: number;
  /** Weight of the recent speed when blending it with the historical bucket speed (0..1). */
  readonly recentSpeedWeight: number;
  /** Effective speed used when neither recent nor historical speed is known. */
  readonly defaultSpeedMps: number;
}

export const DEFAULT_ETA_SETTINGS: EtaSettings = Object.freeze({
  maxFixAgeSec: 60,
  minSpeedMps: 0.5,
  maxSpeedMps: 12,
  recentSpeedTimeConstantSec: 90,
  bucketLengthMeters: 100,
  recentSpeedWeight: 0.5,
  defaultSpeedMps: 8 / 3.6,
});
