import { describe, expect, it } from 'vitest';

import { RI01_GEOMETRY, RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import type { PointEta } from '../../eta/domain/eta-estimator.js';
import { INITIAL_RECENT_SPEED } from '../../eta/domain/recent-speed.js';
import type { LiveTrip } from './live-ports.js';
import { pointCodesOf, toEtaViews, toLiveTripView } from './live-views.js';

const NOW = new Date('2026-10-20T12:10:00Z');
const [p01, p02, p03, p04] = RI01_SNAPSHOT.points;
const codes = pointCodesOf(RI01_SNAPSHOT);

function liveTrip(overrides: Partial<LiveTrip['trip']['state']> = {}): LiveTrip {
  return {
    trip: {
      state: {
        tripId: 'trip-1',
        status: 'active',
        progressChainage: RI01_GEOMETRY.lengthMeters / 4,
        progressAt: new Date(NOW.getTime() - 10_000),
        lastFixAt: new Date(NOW.getTime() - 10_000),
        offRoute: false,
        passedPointIds: [p01!.id],
        endedAt: null,
        ...overrides,
      },
      routeId: RI01_SNAPSHOT.id,
      vehicleId: 'vehicle-1',
      startMode: 'auto',
      startedAt: new Date('2026-10-20T12:00:00Z'),
      endReason: null,
      recentSpeed: INITIAL_RECENT_SPEED,
    },
    vehicle: { code: 'UNIDAD-A', label: 'Unidad A' },
    lastPosition: { lat: -9.52, lon: -77.53, fixTime: new Date(NOW.getTime() - 10_000) },
    passes: [
      { pointId: p01!.id, passedAt: new Date('2026-10-20T12:01:00Z'), precision: 'interpolated' },
    ],
    alerts: [
      {
        pointId: p02!.id,
        emittedAt: new Date('2026-10-20T12:02:00Z'),
        communicatedPredictedPassAt: new Date('2026-10-20T12:09:00Z'),
        recipients: 3,
        delivered: 2,
      },
    ],
  };
}

describe('toEtaViews', () => {
  it('gives live points a prediction, whole seconds and a display window', () => {
    const etas: PointEta[] = [
      {
        pointId: p02!.id,
        status: 'live',
        predictedPassAt: new Date('2026-10-20T12:20:00.400Z'),
        secondsRemaining: 600.4,
      },
    ];

    expect(toEtaViews(etas, codes)).toEqual([
      {
        pointId: p02!.id,
        pointCode: 'P02',
        status: 'live',
        predictedPassAt: '2026-10-20T12:20:00.400Z',
        secondsRemaining: 600,
        window: { minMinutes: 8, maxMinutes: 12 },
      },
    ]);
  });

  it('never gives stale, passed or not-started points a prediction', () => {
    const etas: PointEta[] = [
      { pointId: p01!.id, status: 'passed' },
      { pointId: p02!.id, status: 'stale' },
      { pointId: p03!.id, status: 'not_started' },
    ];

    expect(toEtaViews(etas, codes)).toEqual([
      { pointId: p01!.id, pointCode: 'P01', status: 'passed' },
      { pointId: p02!.id, pointCode: 'P02', status: 'stale' },
      { pointId: p03!.id, pointCode: 'P03', status: 'not_started' },
    ]);
  });

  it('leaves out points that are no longer on the route', () => {
    expect(toEtaViews([{ pointId: 'retired', status: 'stale' }], codes)).toEqual([]);
  });
});

describe('toLiveTripView', () => {
  const etas: PointEta[] = [{ pointId: p04!.id, status: 'stale' }];

  it('maps the trip, its vehicle, position, progress, passes and alerts', () => {
    const view = toLiveTripView({
      live: liveTrip(),
      route: RI01_SNAPSHOT,
      etas,
      now: NOW,
      maxFixAgeSec: 60,
    });

    expect(view).toEqual({
      tripId: 'trip-1',
      startedAt: '2026-10-20T12:00:00.000Z',
      startMode: 'auto',
      vehicle: { code: 'UNIDAD-A', label: 'Unidad A' },
      signal: 'live',
      lastFixAt: '2026-10-20T12:09:50.000Z',
      lastPosition: { lat: -9.52, lon: -77.53, fixTime: '2026-10-20T12:09:50.000Z' },
      progress: {
        chainageMeters: Math.round((RI01_GEOMETRY.lengthMeters / 4) * 10) / 10,
        percent: 25,
        offRoute: false,
      },
      etas: [{ pointId: p04!.id, pointCode: 'P04', status: 'stale' }],
      passes: [
        {
          pointId: p01!.id,
          pointCode: 'P01',
          passedAt: '2026-10-20T12:01:00.000Z',
          precision: 'interpolated',
        },
      ],
      alerts: [
        {
          pointId: p02!.id,
          pointCode: 'P02',
          emittedAt: '2026-10-20T12:02:00.000Z',
          communicatedPredictedPassAt: '2026-10-20T12:09:00.000Z',
          recipients: 3,
          delivered: 2,
        },
      ],
    });
  });

  it.each([
    ['stale', { lastFixAt: new Date(NOW.getTime() - 61_000) }],
    ['none', { lastFixAt: null, progressAt: null }],
  ] as const)('reports the %s signal', (signal, state) => {
    const view = toLiveTripView({
      live: liveTrip(state),
      route: RI01_SNAPSHOT,
      etas,
      now: NOW,
      maxFixAgeSec: 60,
    });

    expect(view.signal).toBe(signal);
  });

  it('never reports more than 100 % progress', () => {
    const view = toLiveTripView({
      live: liveTrip({ progressChainage: RI01_GEOMETRY.lengthMeters + 5 }),
      route: RI01_SNAPSHOT,
      etas,
      now: NOW,
      maxFixAgeSec: 60,
    });

    expect(view.progress.percent).toBe(100);
  });
});
