import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryTrackingStore,
  InMemoryVehicleDirectory,
  ManualClock,
} from '../../../test/fakes/in-memory-tracking-store.js';
import {
  RI01_GEOMETRY,
  RI01_SNAPSHOT,
  ri01PositionAt,
  stopAndGoChainageAt,
} from '../../../test/support/ri01-tracking.js';
import type { AlertNotifier } from '../../alerts/application/alert-notifier.js';
import {
  SpeedProfileProvider,
  type CompletedTripSamplesSource,
} from '../../eta/application/speed-profile-provider.js';
import { RouteCatalog, type RouteRepository } from '../../routes/application/route-catalog.js';
import { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { InMemoryEventBus } from '../../shared/infrastructure/events/in-memory-event-bus.js';
import { IngestPositionService, type IngestPositionCommand } from './ingest-position-service.js';
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
const noRouteTruck: Vehicle = {
  ...truck,
  id: 'vehicle-2',
  traccarUniqueId: 'imei-2',
  defaultRouteId: null,
};

function setup() {
  const findRoute = vi.fn<RouteRepository['findById']>(() => Promise.resolve(RI01_SNAPSHOT));
  const recentCompletedTrips = vi.fn<CompletedTripSamplesSource['recentCompletedTrips']>(() =>
    Promise.resolve([]),
  );
  const store = new InMemoryTrackingStore();
  const clock = new ManualClock(new Date(T0));
  const bus = new InMemoryEventBus<TrackingEvents>(SILENT_LOGGER);
  const published: { name: TrackingEventName; payload: unknown }[] = [];
  const names: TrackingEventName[] = [
    'vehicle.position',
    'trip.started',
    'trip.updated',
    'trip.completed',
    'point.passed',
    'eta.updated',
    'alert.emitted',
  ];
  for (const name of names) bus.subscribe(name, (payload) => published.push({ name, payload }));
  const notify = vi.fn<AlertNotifier['notify']>(() => Promise.resolve());
  const notifier: AlertNotifier = { notify };
  const profiles = new SpeedProfileProvider(
    { recentCompletedTrips },
    { maxTrips: 20, bucketLengthMeters: 100 },
  );
  const routes = new RouteCatalog({ findById: findRoute });
  const logger = { ...SILENT_LOGGER, warn: vi.fn(), error: vi.fn() };
  const service = new IngestPositionService({
    vehicles: new InMemoryVehicleDirectory([truck, noRouteTruck]),
    store,
    routes,
    profiles,
    notifier,
    events: bus,
    clock,
    logger,
    mutex: new KeyedMutex(),
    settings: DEFAULT_TRACKING_PIPELINE_SETTINGS,
  });
  let nextPositionId = 1;
  /** Sends a fix at `chainage`, `seconds` after T0, with the server clock one second later. */
  const send = (
    chainage: number,
    seconds: number,
    overrides: Partial<IngestPositionCommand> = {},
  ) => {
    clock.set(new Date(T0 + seconds * 1000 + 1000));
    const position = ri01PositionAt(chainage);
    return service.ingest({
      traccarPositionId: nextPositionId++,
      deviceUniqueId: truck.traccarUniqueId,
      fixTime: new Date(T0 + seconds * 1000),
      serverTime: null,
      lat: position.lat,
      lon: position.lon,
      speedKmh: 5,
      course: null,
      valid: true,
      accuracy: null,
      ...overrides,
    });
  };
  return {
    store,
    clock,
    published,
    notify,
    notifier,
    profiles,
    routes,
    findRoute,
    recentCompletedTrips,
    logger,
    service,
    send,
  };
}

describe('IngestPositionService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('ignores positions from unknown devices without storing them', async () => {
    const result = await ctx.send(0, 0, { deviceUniqueId: 'stranger' });

    expect(result).toEqual({ status: 'unknown_device' });
    expect(ctx.store.positions).toHaveLength(0);
    expect(ctx.published).toEqual([]);
  });

  it('treats a replayed Traccar position as an idempotent no-op', async () => {
    const first = await ctx.send(0, 0, { traccarPositionId: 42 });
    const eventsAfterFirst = ctx.published.length;
    const replay = await ctx.send(0, 0, { traccarPositionId: 42 });

    expect(first.status).toBe('processed');
    expect(replay).toEqual({ status: 'duplicate' });
    expect(ctx.store.positions).toHaveLength(1);
    expect(ctx.published).toHaveLength(eventsAfterFirst);
  });

  it('auto-starts a trip when the vehicle shows up on its route near the start', async () => {
    const result = await ctx.send(20, 0);

    const [trip] = ctx.store.trips;
    expect(trip).toMatchObject({ startMode: 'auto', routeId: RI01_SNAPSHOT.id });
    expect(trip?.startedAt).toEqual(new Date(T0));
    expect(result).toEqual({ status: 'processed', positionId: '1', tripId: trip?.state.tripId });
    expect(ctx.published.map((e) => e.name)).toEqual([
      'vehicle.position',
      'trip.started',
      'trip.updated',
      'eta.updated',
    ]);
    expect(ctx.store.positions[0]).toMatchObject({ tripId: trip?.state.tripId, offRoute: false });
  });

  it('does not auto-start away from the route start, off route, or without a default route', async () => {
    await ctx.send(600, 0);
    await ctx.send(20, 20, { lon: ri01PositionAt(20, 200).lon });
    await ctx.send(20, 40, { deviceUniqueId: noRouteTruck.traccarUniqueId });

    expect(ctx.store.trips).toEqual([]);
    expect(ctx.store.positions.map((p) => p.tripId)).toEqual([null, null, null]);
    expect(ctx.published.map((e) => e.name)).toEqual([
      'vehicle.position',
      'vehicle.position',
      'vehicle.position',
    ]);
  });

  it('records passes, the position outcome and the recent speed as the trip advances', async () => {
    const p01 = RI01_SNAPSHOT.points[0]!;
    await ctx.send(0, 0);
    await ctx.send(p01.chainage + 10, 20);
    await ctx.send(p01.chainage + 10, 40, { lon: ri01PositionAt(p01.chainage, 150).lon });

    const trip = ctx.store.trips[0]!;
    expect(ctx.store.passesOf(trip.state.tripId)).toEqual([
      expect.objectContaining({ pointId: p01.id, precision: 'interpolated' }),
    ]);
    expect(trip.state.offRoute).toBe(true);
    expect(trip.recentSpeed.speedMps).toBeCloseTo((p01.chainage + 10) / 20, 1);
    expect(ctx.store.positions.map((p) => p.offRoute)).toEqual([false, false, true]);
    expect(ctx.store.positions[1]?.chainage).toBeCloseTo(p01.chainage + 10, 0);
    expect(ctx.store.positions[2]?.chainage).toBeNull();
    expect(ctx.published.filter((e) => e.name === 'point.passed')).toHaveLength(1);
  });

  it('does not alert before it has any speed basis (first fix, no history)', async () => {
    await ctx.send(0, 0);

    expect(ctx.store.alerts).toEqual([]);
    const eta = ctx.published.find((e) => e.name === 'eta.updated');
    expect(eta).toBeDefined();
  });

  it('emits each alert once, notifies it, and keeps going when the notifier fails', async () => {
    ctx.notify.mockRejectedValueOnce(new Error('push service down'));
    for (let s = 0; s <= 400; s += 20) await ctx.send(stopAndGoChainageAt(s), s);
    // The same fix again under a new Traccar id: ignored by the trip, and alerts are not repeated.
    await ctx.send(stopAndGoChainageAt(400), 400);
    await ctx.service.whenNotificationsSettled();

    const alertedPoints = ctx.store.alerts.map((a) => a.pointId);
    expect(alertedPoints.length).toBeGreaterThan(0);
    expect(new Set(alertedPoints).size).toBe(alertedPoints.length);
    expect(ctx.notify).toHaveBeenCalledTimes(alertedPoints.length);
    expect(ctx.published.filter((e) => e.name === 'alert.emitted')).toHaveLength(
      alertedPoints.length,
    );
    expect(ctx.logger.error).toHaveBeenCalledOnce();
  });

  it('answers without waiting for the alert notifications', async () => {
    let release!: () => void;
    ctx.notify.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    for (let s = 0; s <= 400 && ctx.store.alerts.length === 0; s += 20) {
      await ctx.send(stopAndGoChainageAt(s), s);
    }
    expect(ctx.store.alerts.length).toBeGreaterThan(0);
    let settled = false;
    const settling = ctx.service.whenNotificationsSettled().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    ctx.notify.mockResolvedValue(undefined);
    release();
    await settling;
    expect(settled).toBe(true);
  });

  it('suspends ETAs and alerts when the fix is older than the staleness limit', async () => {
    await ctx.send(0, 0);
    ctx.published.length = 0;
    ctx.clock.set(new Date(T0 + 200_000));
    const position = ri01PositionAt(100);

    await ctx.service.ingest({
      traccarPositionId: 999,
      deviceUniqueId: truck.traccarUniqueId,
      fixTime: new Date(T0 + 60_000),
      serverTime: null,
      ...position,
      speedKmh: 5,
      course: null,
      valid: true,
      accuracy: null,
    });

    const eta = ctx.published.find((e) => e.name === 'eta.updated')?.payload as
      TrackingEvents['eta.updated'] | undefined;
    const pending = eta?.etas.filter((e) => e.status !== 'passed') ?? [];
    expect(pending.length).toBeGreaterThan(0);
    for (const item of pending) {
      expect(item.status).toBe('stale');
      expect(item).not.toHaveProperty('predictedPassAt');
    }
    expect(ctx.store.alerts).toEqual([]);
  });

  it('completes the trip at the route end and invalidates the route speed profile', async () => {
    const invalidate = vi.spyOn(ctx.profiles, 'invalidate');
    const end = RI01_GEOMETRY.lengthMeters;
    const chainages = [...Array.from({ length: 13 }, (_, i) => i * 100), end - 5];
    for (const [i, chainage] of chainages.entries()) await ctx.send(chainage, i * 60);

    const trip = ctx.store.trips[0]!;
    expect(trip.state.status).toBe('completed');
    expect(trip.endReason).toBe('route_completed');
    expect(ctx.store.passesOf(trip.state.tripId)).toHaveLength(RI01_SNAPSHOT.points.length);
    expect(invalidate).toHaveBeenCalledWith(RI01_SNAPSHOT.id);
    const names = ctx.published.map((e) => e.name);
    expect(names.at(-1)).toBe('trip.completed');
    expect(ctx.published.at(-1)?.payload).toMatchObject({
      status: 'completed',
      endReason: 'route_completed',
    });

    // The next fix near the end starts nothing: it is far from the route start.
    await ctx.send(end - 5, 2000);
    expect(ctx.store.trips).toHaveLength(1);
  });

  it('creates exactly one trip for two concurrent first fixes of the same vehicle', async () => {
    const results = await Promise.all([ctx.send(10, 0), ctx.send(20, 1)]);

    expect(ctx.store.trips).toHaveLength(1);
    const tripId = ctx.store.trips[0]!.state.tripId;
    expect(results).toEqual([
      expect.objectContaining({ status: 'processed', tripId }),
      expect.objectContaining({ status: 'processed', tripId }),
    ]);
    expect(ctx.published.filter((e) => e.name === 'trip.started')).toHaveLength(1);
  });

  it('falls back to recent speed only when the speed profile cannot be loaded', async () => {
    ctx.recentCompletedTrips.mockRejectedValue(new Error('profile query failed'));

    const result = await ctx.send(20, 0);

    expect(result.status).toBe('processed');
    expect(ctx.store.positions).toHaveLength(1);
    expect(ctx.store.trips).toHaveLength(1);
    expect(ctx.published.map((e) => e.name)).toContain('eta.updated');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: RI01_SNAPSHOT.id }),
      expect.stringContaining('speed profile'),
    );
  });

  it.each([
    ['is missing', () => Promise.resolve(null)],
    ['fails to load', () => Promise.reject(new Error('route query failed'))],
  ])(
    'stores the fix but skips trip advancement when the trip route %s',
    async (_case, findRoute: () => Promise<null>) => {
      await ctx.send(0, 0);
      const trip = ctx.store.trips[0]!;
      ctx.findRoute.mockImplementation(findRoute);
      ctx.routes.invalidate();
      ctx.published.length = 0;

      const first = await ctx.send(100, 20);
      const second = await ctx.send(200, 40);

      expect([first, second]).toEqual([
        expect.objectContaining({ status: 'processed', tripId: trip.state.tripId }),
        expect.objectContaining({ status: 'processed', tripId: trip.state.tripId }),
      ]);
      expect(ctx.store.positions).toHaveLength(3);
      expect(ctx.store.positions.slice(1).map((p) => [p.tripId, p.chainage])).toEqual([
        [trip.state.tripId, null],
        [trip.state.tripId, null],
      ]);
      expect(ctx.store.trips[0]).toEqual(trip);
      expect(ctx.published.map((e) => e.name)).toEqual(['vehicle.position', 'vehicle.position']);
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: trip.state.tripId, vehicleId: truck.id }),
        expect.stringContaining('route'),
      );
    },
  );
});
