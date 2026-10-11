import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryTrackingStore,
  InMemoryVehicleDirectory,
  ManualClock,
} from '../../../test/fakes/in-memory-tracking-store.js';
import { RI01_SNAPSHOT, ri01PositionAt } from '../../../test/support/ri01-tracking.js';
import type { AlertNotifier } from '../../alerts/application/alert-notifier.js';
import {
  SpeedProfileProvider,
  type CompletedTripSamplesSource,
} from '../../eta/application/speed-profile-provider.js';
import { DEFAULT_ETA_SETTINGS } from '../../eta/domain/eta-settings.js';
import { RouteCatalog, type RouteRepository } from '../../routes/application/route-catalog.js';
import { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { InMemoryEventBus } from '../../shared/infrastructure/events/in-memory-event-bus.js';
import { EtaRefreshService } from './eta-refresh-service.js';
import { IngestPositionService } from './ingest-position-service.js';
import type { Vehicle } from './ports.js';
import type { TrackingEventName, TrackingEvents } from './tracking-events.js';
import { DEFAULT_TRACKING_PIPELINE_SETTINGS } from './tracking-pipeline-settings.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
const truck: Vehicle = {
  id: 'vehicle-1',
  code: 'UNIDAD-A',
  label: 'Unidad A',
  traccarUniqueId: 'imei-1',
  defaultRouteId: RI01_SNAPSHOT.id,
  active: true,
};

function setup() {
  const store = new InMemoryTrackingStore();
  const clock = new ManualClock(new Date(T0));
  const bus = new InMemoryEventBus<TrackingEvents>(SILENT_LOGGER);
  const published: { name: TrackingEventName; payload: unknown }[] = [];
  for (const name of ['eta.updated', 'alert.emitted'] as const) {
    bus.subscribe(name, (payload) => published.push({ name, payload }));
  }
  const findRoute = vi.fn<RouteRepository['findById']>(() => Promise.resolve(RI01_SNAPSHOT));
  const recentCompletedTrips = vi.fn<CompletedTripSamplesSource['recentCompletedTrips']>(() =>
    Promise.resolve([]),
  );
  const routes = new RouteCatalog({ findById: findRoute });
  const profiles = new SpeedProfileProvider(
    { recentCompletedTrips },
    { maxTrips: 20, bucketLengthMeters: 100 },
  );
  const mutex = new KeyedMutex();
  const notify = vi.fn<AlertNotifier['notify']>(() => Promise.resolve());
  const ingest = new IngestPositionService({
    vehicles: new InMemoryVehicleDirectory([truck]),
    store,
    routes,
    profiles,
    notifier: { notify },
    events: bus,
    clock,
    logger: SILENT_LOGGER,
    mutex,
    settings: DEFAULT_TRACKING_PIPELINE_SETTINGS,
  });
  const logger = { ...SILENT_LOGGER, warn: vi.fn(), error: vi.fn() };
  const refresh = new EtaRefreshService({
    trips: store,
    routes,
    profiles,
    events: bus,
    clock,
    logger,
    mutex,
    settings: DEFAULT_ETA_SETTINGS,
  });
  let nextId = 1;
  const send = (chainage: number, seconds: number) => {
    clock.set(new Date(T0 + seconds * 1000));
    const position = ri01PositionAt(chainage);
    return ingest.ingest({
      traccarPositionId: nextId++,
      deviceUniqueId: truck.traccarUniqueId,
      fixTime: new Date(T0 + seconds * 1000),
      serverTime: null,
      ...position,
      speedKmh: 5,
      course: null,
      valid: true,
      accuracy: null,
    });
  };
  const etaEvents = () =>
    published
      .filter((e) => e.name === 'eta.updated')
      .map((e) => e.payload as TrackingEvents['eta.updated']);
  return {
    store,
    clock,
    published,
    etaEvents,
    findRoute,
    recentCompletedTrips,
    routes,
    profiles,
    logger,
    refresh,
    send,
  };
}

describe('EtaRefreshService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('publishes nothing without active trips', async () => {
    expect(await ctx.refresh.refreshAll()).toBe(0);
    expect(ctx.published).toEqual([]);
  });

  it('counts the ETAs down between fixes from the persisted trip state', async () => {
    for (let s = 0; s <= 120; s += 20) await ctx.send(s * 1.5, s);
    const fromFix = ctx.etaEvents().at(-1)!;
    ctx.published.length = 0;
    ctx.clock.set(new Date(T0 + 135_000));

    expect(await ctx.refresh.refreshAll()).toBe(1);

    const [refreshed] = ctx.etaEvents();
    expect(refreshed).toMatchObject({
      tripId: fromFix.tripId,
      routeId: RI01_SNAPSHOT.id,
      vehicleId: truck.id,
      computedAt: new Date(T0 + 135_000),
      lastFixAt: new Date(T0 + 120_000),
    });
    const before = fromFix.etas.find((e) => e.status === 'live')!;
    const after = refreshed!.etas.find((e) => e.pointId === before.pointId)!;
    expect(after.status).toBe('live');
    if (before.status === 'live' && after.status === 'live') {
      expect(after.predictedPassAt).toEqual(before.predictedPassAt);
      expect(after.secondsRemaining).toBeCloseTo(before.secondsRemaining - 15, 6);
    }
  });

  it('turns every pending point stale once the telemetry is older than the limit', async () => {
    for (let s = 0; s <= 120; s += 20) await ctx.send(s * 1.5, s);
    ctx.published.length = 0;
    ctx.clock.set(new Date(T0 + 181_000));

    await ctx.refresh.refreshAll();

    const pending = ctx.etaEvents()[0]!.etas.filter((e) => e.status !== 'passed');
    expect(pending.length).toBeGreaterThan(0);
    for (const eta of pending) expect(eta).toEqual({ pointId: eta.pointId, status: 'stale' });
  });

  it('never records or emits alerts', async () => {
    for (let s = 0; s <= 120; s += 20) await ctx.send(s * 1.5, s);
    const alerts = ctx.store.alerts.length;
    ctx.published.length = 0;

    for (let s = 125; s <= 400; s += 15) {
      ctx.clock.set(new Date(T0 + s * 1000));
      await ctx.refresh.refreshAll();
    }

    expect(ctx.store.alerts).toHaveLength(alerts);
    expect(ctx.published.map((e) => e.name)).not.toContain('alert.emitted');
  });

  it('skips a trip whose route is missing', async () => {
    await ctx.send(0, 0);
    ctx.published.length = 0;
    ctx.findRoute.mockResolvedValue(null);
    ctx.routes.invalidate();

    expect(await ctx.refresh.refreshAll()).toBe(0);
    expect(ctx.published).toEqual([]);
  });

  it('logs a failed trip refresh and resolves', async () => {
    await ctx.send(0, 0);
    ctx.findRoute.mockRejectedValue(new Error('route query failed'));
    ctx.routes.invalidate();

    await expect(ctx.refresh.refreshAll()).resolves.toBe(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: truck.id, err: expect.any(Error) as unknown }),
      'ETA refresh of a trip failed',
    );
  });

  it('falls back to the recent speed when the speed profile cannot be loaded', async () => {
    await ctx.send(0, 0);
    ctx.recentCompletedTrips.mockRejectedValue(new Error('profile query failed'));
    ctx.profiles.invalidate(RI01_SNAPSHOT.id);

    expect(await ctx.refresh.refreshAll()).toBe(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: RI01_SNAPSHOT.id }),
      expect.stringContaining('speed profile'),
    );
  });
});
