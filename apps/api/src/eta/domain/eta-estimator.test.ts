import { describe, expect, it } from 'vitest';

import { DEFAULT_ETA_SETTINGS } from './eta-settings.js';
import { estimateEtas, type EtaInput, type PointEta } from './eta-estimator.js';
import type { SpeedProfile } from './speed-profile.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000);
const points = [
  { id: 'p1', chainage: 100 },
  { id: 'p2', chainage: 400 },
  { id: 'p3', chainage: 1000 },
];

function input(overrides: Partial<EtaInput> = {}): EtaInput {
  return {
    now: at(0),
    trip: { progressChainage: 200, progressAt: at(0), lastFixAt: at(0), passedPointIds: ['p1'] },
    points,
    recentSpeedMps: 2,
    profile: null,
    ...overrides,
  };
}

function secondsRemaining(eta: PointEta | undefined): number {
  if (eta?.status !== 'live') throw new Error(`Expected a live ETA, got ${eta?.status}`);
  return eta.secondsRemaining;
}

describe('estimateEtas', () => {
  it('reports passed points as passed', () => {
    expect(estimateEtas(input())[0]).toEqual({ pointId: 'p1', status: 'passed' });
  });

  it('predicts live ETAs from the recent speed when there is no history', () => {
    const [, p2, p3] = estimateEtas(input());

    expect(p2).toEqual({
      pointId: 'p2',
      status: 'live',
      predictedPassAt: at(100),
      secondsRemaining: 100,
    });
    expect(p3).toEqual({
      pointId: 'p3',
      status: 'live',
      predictedPassAt: at(400),
      secondsRemaining: 400,
    });
  });

  it('counts time already elapsed since progress was measured', () => {
    const [, p2] = estimateEtas(input({ now: at(30) }));

    expect(p2).toMatchObject({ status: 'live', predictedPassAt: at(100), secondsRemaining: 70 });
  });

  it('never predicts a pass in the past', () => {
    const [, p2] = estimateEtas(
      input({
        now: at(50),
        trip: { progressChainage: 395, progressAt: at(0), lastFixAt: at(40), passedPointIds: [] },
      }),
    );

    expect(p2).toMatchObject({ status: 'live', predictedPassAt: at(50), secondsRemaining: 0 });
  });

  it('suspends every ETA on stale telemetry and exposes no prediction', () => {
    const etas = estimateEtas(input({ now: at(61) }));

    expect(etas).toEqual([
      { pointId: 'p1', status: 'passed' },
      { pointId: 'p2', status: 'stale' },
      { pointId: 'p3', status: 'stale' },
    ]);
  });

  it('reports not_started before the first on-route fix', () => {
    const etas = estimateEtas(
      input({
        trip: { progressChainage: 0, progressAt: null, lastFixAt: null, passedPointIds: [] },
      }),
    );

    expect(etas.map((e) => e.status)).toEqual(['not_started', 'not_started', 'not_started']);
  });

  it('blends recent and historical speed per bucket', () => {
    // Buckets 200–300 and 300–400 at 4 m/s historically; recent 2 m/s; w = 0.5 → 3 m/s.
    const profile: SpeedProfile = { bucketLengthMeters: 100, bucketSpeedsMps: [4, 4, 4, 4] };

    const [, p2] = estimateEtas(input({ profile }));

    expect(secondsRemaining(p2)).toBeCloseTo(200 / 3, 6);
  });

  it('uses the historical speed alone when there is no recent speed', () => {
    const profile: SpeedProfile = { bucketLengthMeters: 100, bucketSpeedsMps: [4, 4, 4, 4] };

    const [, p2] = estimateEtas(input({ profile, recentSpeedMps: null }));

    expect(p2).toMatchObject({ secondsRemaining: 50 });
  });

  it('integrates partial buckets and falls back to recent speed beyond the history', () => {
    const profile: SpeedProfile = { bucketLengthMeters: 100, bucketSpeedsMps: [4, 4, 4] };
    const trip = { progressChainage: 250, progressAt: at(0), lastFixAt: at(0), passedPointIds: [] };

    const [, p2] = estimateEtas(input({ profile, trip }));

    // 250–300 at 3 m/s, then 300–400 has no history so it uses 2 m/s.
    expect(secondsRemaining(p2)).toBeCloseTo(50 / 3 + 50, 6);
  });

  it('falls back to the default effective speed (8 km/h) without any speed data', () => {
    const [, p2] = estimateEtas(input({ recentSpeedMps: null }));

    expect(secondsRemaining(p2)).toBeCloseTo(200 / DEFAULT_ETA_SETTINGS.defaultSpeedMps, 6);
  });
});
