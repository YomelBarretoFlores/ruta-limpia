import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualClock } from '../../../test/fakes/in-memory-tracking-store.js';
import { RI01_GEOMETRY, RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import {
  SpeedProfileProvider,
  type CompletedTripSamplesSource,
} from '../../eta/application/speed-profile-provider.js';
import { DEFAULT_ETA_SETTINGS } from '../../eta/domain/eta-settings.js';
import { RouteCatalog, type RouteSnapshot } from '../../routes/application/route-catalog.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import type { LiveTrip } from './live-ports.js';
import { LiveSnapshotService } from './live-snapshot-service.js';

const NOW = new Date('2026-10-20T12:10:00Z');
const [p01] = RI01_SNAPSHOT.points;

function liveTrip(lastFixAgoSec: number): LiveTrip {
  const lastFixAt = new Date(NOW.getTime() - lastFixAgoSec * 1000);
  return {
    trip: {
      state: {
        tripId: 'trip-1',
        status: 'active',
        progressChainage: 120,
        progressAt: lastFixAt,
        lastFixAt,
        offRoute: false,
        passedPointIds: [p01!.id],
        endedAt: null,
      },
      routeId: RI01_SNAPSHOT.id,
      vehicleId: 'vehicle-1',
      startMode: 'auto',
      startedAt: new Date('2026-10-20T12:00:00Z'),
      endReason: null,
      recentSpeed: { speedMps: 1.5, averageMps: 1.5, lastSample: null },
    },
    vehicle: { code: 'UNIDAD-A', label: 'Unidad A' },
    lastPosition: null,
    passes: [],
    alerts: [],
  };
}

function setup() {
  const trips: LiveTrip[] = [];
  const findActiveIdByCode = vi.fn((code: string) =>
    Promise.resolve(code === 'RI-01' ? RI01_SNAPSHOT.id : null),
  );
  const findRoute = vi.fn((): Promise<RouteSnapshot | null> => Promise.resolve(RI01_SNAPSHOT));
  const recentCompletedTrips = vi.fn<CompletedTripSamplesSource['recentCompletedTrips']>(() =>
    Promise.resolve([]),
  );
  const logger = { ...SILENT_LOGGER, warn: vi.fn() };
  const service = new LiveSnapshotService({
    routeIds: { findActiveIdByCode },
    routes: new RouteCatalog({ findById: findRoute }),
    readModel: { activeTrips: () => Promise.resolve(trips) },
    profiles: new SpeedProfileProvider(
      { recentCompletedTrips },
      { maxTrips: 20, bucketLengthMeters: 100 },
    ),
    clock: new ManualClock(NOW),
    logger,
    etaSettings: DEFAULT_ETA_SETTINGS,
  });
  return { trips, findRoute, recentCompletedTrips, logger, service };
}

describe('LiveSnapshotService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('finds active routes by code only', async () => {
    expect(await ctx.service.findRoute('RI-01')).toBe(RI01_SNAPSHOT);
    expect(await ctx.service.findRoute('RH-09')).toBeNull();
  });

  it('hides a route that was deactivated after it was cached', async () => {
    ctx.findRoute.mockResolvedValue({ ...RI01_SNAPSHOT, active: false });

    expect(await ctx.service.snapshotByCode('RI-01')).toBeNull();
  });

  it('shows an empty snapshot when no trip runs the route', async () => {
    expect(await ctx.service.snapshot(RI01_SNAPSHOT)).toEqual({
      route: { code: 'RI-01', name: RI01_SNAPSHOT.name },
      generatedAt: NOW.toISOString(),
      staleAfterSeconds: 60,
      trips: [],
    });
    expect(ctx.recentCompletedTrips).not.toHaveBeenCalled();
  });

  it('recomputes the ETAs at the current time from the persisted trip state', async () => {
    ctx.trips.push(liveTrip(20));

    const snapshot = await ctx.service.snapshot(RI01_SNAPSHOT);

    const [trip] = snapshot.trips;
    expect(trip?.signal).toBe('live');
    expect(trip?.etas[0]).toMatchObject({ pointCode: 'P01', status: 'passed' });
    const p03Chainage = RI01_SNAPSHOT.points[2]!.chainage;
    // Travel from 120 m at 1.5 m/s, minus the 20 s already elapsed since that progress.
    const expected = Math.round((p03Chainage - 120) / 1.5 - 20);
    expect(trip?.etas[2]).toMatchObject({
      pointCode: 'P03',
      status: 'live',
      secondsRemaining: expected,
    });
    expect(expected).toBeGreaterThan(0);
    expect(trip?.progress.percent).toBeCloseTo((120 / RI01_GEOMETRY.lengthMeters) * 100, 0);
  });

  it('suspends every prediction when the telemetry is stale', async () => {
    ctx.trips.push(liveTrip(61));

    const [trip] = (await ctx.service.snapshot(RI01_SNAPSHOT)).trips;

    expect(trip?.signal).toBe('stale');
    const pending = trip?.etas.filter((e) => e.status !== 'passed') ?? [];
    expect(pending).toHaveLength(RI01_SNAPSHOT.points.length - 1);
    for (const eta of pending) {
      expect(eta).toEqual({ pointId: eta.pointId, pointCode: eta.pointCode, status: 'stale' });
    }
  });

  it('falls back to the recent speed when the speed profile cannot be loaded', async () => {
    ctx.trips.push(liveTrip(5));
    ctx.recentCompletedTrips.mockRejectedValue(new Error('profile query failed'));

    const [trip] = (await ctx.service.snapshot(RI01_SNAPSHOT)).trips;

    expect(trip?.etas[2]?.status).toBe('live');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: RI01_SNAPSHOT.id }),
      expect.stringContaining('speed profile'),
    );
  });
});
