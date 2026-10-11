import { DEFAULT_ETA_SETTINGS } from './eta-settings.js';
import type { ProgressSample } from './progress-sample.js';

/** Typical effective speed per fixed-length stretch of a route, learned from past trips. */
export interface SpeedProfile {
  readonly bucketLengthMeters: number;
  /** `bucketSpeedsMps[i]` covers chainage [i * L, (i + 1) * L); null when no trip covered it fully. */
  readonly bucketSpeedsMps: readonly (number | null)[];
}

/**
 * Builds the profile from past trips' progress samples. For each trip, a bucket's speed is its length
 * divided by the time between reaching its start and its end (stops included); the profile keeps the
 * median across trips. Buckets a trip did not cover fully get nothing from that trip.
 */
export function buildSpeedProfile(
  trips: readonly (readonly ProgressSample[])[],
  bucketLengthMeters: number = DEFAULT_ETA_SETTINGS.bucketLengthMeters,
): SpeedProfile {
  const speedsByBucket: number[][] = [];
  for (const samples of trips) {
    const ordered = monotonic(samples);
    const last = ordered[ordered.length - 1];
    if (last === undefined) continue;
    for (let i = 0; (i + 1) * bucketLengthMeters <= last.chainage; i++) {
      const enter = timeAtChainage(ordered, i * bucketLengthMeters);
      const exit = timeAtChainage(ordered, (i + 1) * bucketLengthMeters);
      if (enter === null || exit === null || exit <= enter) continue;
      (speedsByBucket[i] ??= []).push(bucketLengthMeters / ((exit - enter) / 1000));
    }
  }
  return {
    bucketLengthMeters,
    bucketSpeedsMps: Array.from(speedsByBucket, (speeds) =>
      speeds === undefined ? null : median(speeds),
    ),
  };
}

/** The historical speed of the bucket containing `chainage`, or null when unknown. */
export function profileSpeedAt(profile: SpeedProfile, chainage: number): number | null {
  return profile.bucketSpeedsMps[Math.floor(chainage / profile.bucketLengthMeters)] ?? null;
}

/** Samples in time order with progress made non-decreasing. */
function monotonic(samples: readonly ProgressSample[]): ProgressSample[] {
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  let max = Number.NEGATIVE_INFINITY;
  return ordered.map((s) => {
    max = Math.max(max, s.chainage);
    return { chainage: max, at: s.at };
  });
}

/** Epoch milliseconds at which progress first reached `chainage`, or null if never observed. */
function timeAtChainage(samples: readonly ProgressSample[], chainage: number): number | null {
  const first = samples[0];
  if (first === undefined || first.chainage > chainage) return null;
  if (first.chainage === chainage) return first.at.getTime();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.chainage >= chainage) {
      const fraction = (chainage - a.chainage) / (b.chainage - a.chainage);
      return a.at.getTime() + fraction * (b.at.getTime() - a.at.getTime());
    }
  }
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
