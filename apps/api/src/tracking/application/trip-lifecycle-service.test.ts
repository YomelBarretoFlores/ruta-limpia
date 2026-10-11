import { describe, expect, it } from 'vitest';

import {
  InMemoryTrackingStore,
  InMemoryVehicleDirectory,
  ManualClock,
} from '../../../test/fakes/in-memory-tracking-store.js';
import { RI01_SNAPSHOT } from '../../../test/support/ri01-tracking.js';
import { RouteCatalog } from '../../routes/application/route-catalog.js';
import { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { InMemoryEventBus } from '../../shared/infrastructure/events/in-memory-event-bus.js';
import type { Vehicle } from './ports.js';
import type { TrackingEvents } from './tracking-events.js';
import { TripLifecycleService } from './trip-lifecycle-service.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
const MINUTE = 60_000;
const vehicle = (id: string): Vehicle => ({
  id,
  code: id.toUpperCase(),
  label: id,
  traccarUniqueId: `imei-${id}`,
  defaultRouteId: RI01_SNAPSHOT.id,
  active: true,
});

function setup() {
  const store = new InMemoryTrackingStore();
  const clock = new ManualClock(new Date(T0));
  const bus = new InMemoryEventBus<TrackingEvents>(SILENT_LOGGER);
  const ended: TrackingEvents['trip.completed'][] = [];
  const started: TrackingEvents['trip.started'][] = [];
  bus.subscribe('trip.completed', (payload) => ended.push(payload));
  bus.subscribe('trip.started', (payload) => started.push(payload));
  const service = new TripLifecycleService({
    vehicles: new InMemoryVehicleDirectory([vehicle('a'), vehicle('b')]),
    store,
    routes: new RouteCatalog({
      findById: (id) => Promise.resolve(id === RI01_SNAPSHOT.id ? RI01_SNAPSHOT : null),
    }),
    events: bus,
    clock,
    logger: SILENT_LOGGER,
    mutex: new KeyedMutex(),
    inactivityTimeoutSec: 30 * 60,
  });
  return { store, clock, service, ended, started };
}

describe('TripLifecycleService', () => {
  it('starts a manual trip and refuses a second active trip for the same vehicle', async () => {
    const { service, started } = setup();

    const trip = await service.startTrip({
      vehicleId: 'a',
      routeId: RI01_SNAPSHOT.id,
      mode: 'manual',
    });

    expect(trip).toMatchObject({ startMode: 'manual', vehicleId: 'a', startedAt: new Date(T0) });
    expect(trip.state.status).toBe('active');
    expect(started).toHaveLength(1);
    await expect(
      service.startTrip({ vehicleId: 'a', routeId: RI01_SNAPSHOT.id, mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'trip_already_active' });
  });

  it('rejects unknown vehicles and routes', async () => {
    const { service } = setup();

    await expect(
      service.startTrip({ vehicleId: 'zzz', routeId: RI01_SNAPSHOT.id, mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'vehicle_not_found' });
    await expect(
      service.startTrip({ vehicleId: 'a', routeId: 'nowhere', mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'route_not_found' });
  });

  it('ends an active trip by hand as aborted, once', async () => {
    const { service, clock, ended } = setup();
    const trip = await service.startTrip({
      vehicleId: 'a',
      routeId: RI01_SNAPSHOT.id,
      mode: 'manual',
    });
    clock.set(new Date(T0 + 5 * MINUTE));

    const closed = await service.endTrip(trip.state.tripId, 'manual');

    expect(closed.state).toMatchObject({ status: 'aborted', endedAt: new Date(T0 + 5 * MINUTE) });
    expect(closed.endReason).toBe('manual');
    expect(ended).toEqual([expect.objectContaining({ status: 'aborted', endReason: 'manual' })]);
    await expect(service.endTrip(trip.state.tripId)).rejects.toMatchObject({
      code: 'trip_not_active',
    });
    await expect(service.endTrip('missing')).rejects.toMatchObject({ code: 'trip_not_found' });
  });

  it('aborts only the trips without fixes for longer than the inactivity timeout', async () => {
    const { service, clock, store, ended } = setup();
    const idle = await service.startTrip({
      vehicleId: 'a',
      routeId: RI01_SNAPSHOT.id,
      mode: 'manual',
    });
    clock.set(new Date(T0 + 20 * MINUTE));
    const recent = await service.startTrip({
      vehicleId: 'b',
      routeId: RI01_SNAPSHOT.id,
      mode: 'manual',
    });
    clock.set(new Date(T0 + 31 * MINUTE));

    const closed = await service.closeInactiveTrips();

    expect(closed.map((t) => t.state.tripId)).toEqual([idle.state.tripId]);
    expect(store.trips.find((t) => t.state.tripId === idle.state.tripId)).toMatchObject({
      endReason: 'inactivity',
      state: expect.objectContaining({ status: 'aborted' }) as unknown,
    });
    expect(store.trips.find((t) => t.state.tripId === recent.state.tripId)?.state.status).toBe(
      'active',
    );
    expect(ended).toEqual([expect.objectContaining({ endReason: 'inactivity' })]);
  });
});
