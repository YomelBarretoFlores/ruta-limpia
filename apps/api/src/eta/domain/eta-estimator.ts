import { DEFAULT_ETA_SETTINGS, type EtaSettings } from './eta-settings.js';
import { profileSpeedAt, type SpeedProfile } from './speed-profile.js';
import { isStale } from './staleness.js';

export type PointEta =
  | {
      readonly pointId: string;
      readonly status: 'live';
      readonly predictedPassAt: Date;
      readonly secondsRemaining: number;
    }
  | { readonly pointId: string; readonly status: 'stale' | 'passed' | 'not_started' };

export type PointEtaStatus = PointEta['status'];

/** The part of a trip's state the ETA needs; a tracking `TripState` satisfies it. */
export interface TripProgressSnapshot {
  readonly progressChainage: number;
  readonly progressAt: Date | null;
  readonly lastFixAt: Date | null;
  readonly passedPointIds: readonly string[];
}

export interface EtaInput {
  readonly now: Date;
  readonly trip: TripProgressSnapshot;
  readonly points: readonly { readonly id: string; readonly chainage: number }[];
  readonly recentSpeedMps: number | null;
  readonly profile: SpeedProfile | null;
}

/**
 * Estimates when the truck will pass every reference point of the trip.
 *
 * Travel time is integrated bucket by bucket from the current progress to each point, at a blended
 * speed `w * recent + (1 - w) * historical(bucket)` (either one alone when the other is unknown, or the
 * default effective speed when both are). Time already elapsed since progress was measured is
 * deducted, and a prediction is never placed in the past.
 *
 * Stale telemetry suspends the estimate: those points report `stale` and expose no prediction, so a
 * stale ETA can never be shown as current.
 */
export function estimateEtas(
  input: EtaInput,
  settings: EtaSettings = DEFAULT_ETA_SETTINGS,
): PointEta[] {
  const { now, trip } = input;
  const passed = new Set(trip.passedPointIds);
  const stale = isStale(trip.lastFixAt, now, settings.maxFixAgeSec);
  return input.points.map((point): PointEta => {
    if (passed.has(point.id)) return { pointId: point.id, status: 'passed' };
    if (trip.progressAt === null) return { pointId: point.id, status: 'not_started' };
    if (stale) return { pointId: point.id, status: 'stale' };

    const travelSec = travelSeconds(trip.progressChainage, point.chainage, input, settings);
    const elapsedSec = (now.getTime() - trip.progressAt.getTime()) / 1000;
    const secondsRemaining = Math.max(0, travelSec - elapsedSec);
    return {
      pointId: point.id,
      status: 'live',
      predictedPassAt: new Date(Math.round(now.getTime() + secondsRemaining * 1000)),
      secondsRemaining,
    };
  });
}

function travelSeconds(from: number, to: number, input: EtaInput, settings: EtaSettings): number {
  const bucketLength = input.profile?.bucketLengthMeters ?? settings.bucketLengthMeters;
  let seconds = 0;
  for (let at = from; at < to;) {
    const bucketEnd = Math.min(to, (Math.floor(at / bucketLength) + 1) * bucketLength);
    const historical = input.profile === null ? null : profileSpeedAt(input.profile, at);
    seconds += (bucketEnd - at) / blendedSpeed(input.recentSpeedMps, historical, settings);
    at = bucketEnd;
  }
  return seconds;
}

function blendedSpeed(
  recent: number | null,
  historical: number | null,
  settings: EtaSettings,
): number {
  const w = settings.recentSpeedWeight;
  const speed =
    recent !== null && historical !== null
      ? w * recent + (1 - w) * historical
      : (recent ?? historical ?? settings.defaultSpeedMps);
  return Math.min(settings.maxSpeedMps, Math.max(settings.minSpeedMps, speed));
}
