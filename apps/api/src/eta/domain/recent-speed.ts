import { DEFAULT_ETA_SETTINGS, type EtaSettings } from './eta-settings.js';
import type { ProgressSample } from './progress-sample.js';

/**
 * Exponentially weighted moving average of the truck's effective speed along the route, derived from
 * progress deltas over time (stops included), not from the device-reported speed.
 */
export interface RecentSpeed {
  /** Smoothed effective speed in m/s, clamped to [minSpeed, maxSpeed]; null until two samples. */
  readonly speedMps: number | null;
  /** Unclamped moving average; stops count as zero so stop-and-go is not biased upward. */
  readonly averageMps: number | null;
  readonly lastSample: ProgressSample | null;
}

export const INITIAL_RECENT_SPEED: RecentSpeed = Object.freeze({
  speedMps: null,
  averageMps: null,
  lastSample: null,
});

/**
 * Folds one progress sample into the estimate. Sample speeds are capped at `maxSpeed` (jumps) but
 * stops count as zero; only the reported speed is clamped to [minSpeed, maxSpeed]. The smoothing
 * weight `1 - exp(-dt / tau)` grows with the time since the previous sample, so irregular reporting
 * intervals and gaps are weighted fairly.
 */
export function observeProgress(
  estimate: RecentSpeed,
  sample: ProgressSample,
  settings: EtaSettings = DEFAULT_ETA_SETTINGS,
): RecentSpeed {
  const previous = estimate.lastSample;
  if (previous === null) return { ...INITIAL_RECENT_SPEED, lastSample: sample };
  const elapsedSec = (sample.at.getTime() - previous.at.getTime()) / 1000;
  if (elapsedSec <= 0) return estimate;

  const distance = Math.max(0, sample.chainage - previous.chainage);
  const sampleSpeed = Math.min(settings.maxSpeedMps, distance / elapsedSec);
  const alpha = 1 - Math.exp(-elapsedSec / settings.recentSpeedTimeConstantSec);
  const averageMps =
    estimate.averageMps === null
      ? sampleSpeed
      : estimate.averageMps + alpha * (sampleSpeed - estimate.averageMps);
  return {
    speedMps: Math.min(settings.maxSpeedMps, Math.max(settings.minSpeedMps, averageMps)),
    averageMps,
    lastSample: sample,
  };
}
