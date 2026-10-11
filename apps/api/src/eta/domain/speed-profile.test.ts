import { describe, expect, it } from 'vitest';

import { buildSpeedProfile, profileSpeedAt } from './speed-profile.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
/** A trip at constant speed from chainage 0 to `length`, sampled every 20 s. */
function constantTrip(speedMps: number, length: number) {
  const samples = [];
  for (let s = 0; s * speedMps <= length; s += 20) {
    samples.push({ chainage: s * speedMps, at: new Date(T0 + s * 1000) });
  }
  return samples;
}

describe('buildSpeedProfile', () => {
  it('derives each bucket speed from the time taken to cross it', () => {
    const profile = buildSpeedProfile([constantTrip(2, 400)]);

    expect(profile.bucketLengthMeters).toBe(100);
    expect(profile.bucketSpeedsMps).toHaveLength(4);
    for (const speed of profile.bucketSpeedsMps) expect(speed).toBeCloseTo(2, 10);
  });

  it('includes stops in the effective speed', () => {
    const trip = [
      { chainage: 0, at: new Date(T0) },
      { chainage: 50, at: new Date(T0 + 25_000) },
      { chainage: 50, at: new Date(T0 + 75_000) }, // 50 s stop
      { chainage: 100, at: new Date(T0 + 100_000) },
    ];

    expect(buildSpeedProfile([trip]).bucketSpeedsMps[0]).toBeCloseTo(1, 10);
  });

  it('takes the median across trips per bucket', () => {
    const profile = buildSpeedProfile([
      constantTrip(1, 200),
      constantTrip(2, 200),
      constantTrip(6, 200),
    ]);

    expect(profile.bucketSpeedsMps[0]).toBeCloseTo(2, 10);
  });

  it('leaves buckets without full coverage empty', () => {
    const late = [
      { chainage: 150, at: new Date(T0) },
      { chainage: 300, at: new Date(T0 + 75_000) },
    ];

    expect(buildSpeedProfile([late]).bucketSpeedsMps).toEqual([null, null, 2]);
  });

  it('accepts a custom bucket length', () => {
    expect(buildSpeedProfile([constantTrip(2, 400)], 200).bucketSpeedsMps).toHaveLength(2);
  });
});

describe('profileSpeedAt', () => {
  const profile = buildSpeedProfile([constantTrip(2, 200)]);

  it('looks up the bucket that contains the chainage', () => {
    expect(profileSpeedAt(profile, 150)).toBeCloseTo(2, 10);
  });

  it('returns null beyond the profile', () => {
    expect(profileSpeedAt(profile, 250)).toBeNull();
  });
});
