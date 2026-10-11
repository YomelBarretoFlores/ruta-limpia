import type { RouteCatalog } from '../../routes/application/route-catalog.js';
import type { Clock } from '../../shared/application/clock.js';
import type { EventBus } from '../../shared/application/event-bus.js';
import type { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import type { Logger } from '../../shared/application/logger.js';
import { abortTrip, isInactive } from '../domain/trip.js';
import { tripEnded, tripStarted } from './ingest-position-service.js';
import type { TrackingStore, TripEndReason, TripRecord, VehicleDirectory } from './ports.js';
import { publishAll } from './publish.js';
import type { PendingEvent, TrackingEvents } from './tracking-events.js';

export type TripLifecycleErrorCode =
  | 'vehicle_not_found'
  | 'route_not_found'
  | 'trip_already_active'
  | 'trip_not_found'
  | 'trip_not_active';

/** A trip lifecycle request that cannot be honored (the panel maps codes to HTTP statuses). */
export class TripLifecycleError extends Error {
  override readonly name = 'TripLifecycleError';

  constructor(
    readonly code: TripLifecycleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TripLifecycleDependencies {
  readonly vehicles: VehicleDirectory;
  readonly store: TrackingStore;
  readonly routes: RouteCatalog;
  readonly events: EventBus<TrackingEvents>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly mutex: KeyedMutex;
  /** A trip without fixes for this long is aborted by `closeInactiveTrips`. */
  readonly inactivityTimeoutSec: number;
}

/** Operator and housekeeping use cases around trips: manual start, manual end, inactivity. */
export class TripLifecycleService {
  constructor(private readonly deps: TripLifecycleDependencies) {}

  /** Starts a trip by hand (for example when the truck starts away from the route start). */
  async startTrip(input: {
    readonly vehicleId: string;
    readonly routeId: string;
    readonly mode: 'manual';
  }): Promise<TripRecord> {
    const vehicle = await this.deps.vehicles.findById(input.vehicleId);
    if (vehicle === null) {
      throw new TripLifecycleError('vehicle_not_found', `Vehicle ${input.vehicleId} not found`);
    }
    const route = await this.deps.routes.get(input.routeId);
    if (route === null) {
      throw new TripLifecycleError('route_not_found', `Route ${input.routeId} not found`);
    }

    const trip = await this.deps.mutex.runExclusive(vehicle.id, () =>
      this.deps.store.transaction(async (tx) => {
        const active = await tx.lockActiveTrip(vehicle.id);
        if (active !== null) {
          throw new TripLifecycleError(
            'trip_already_active',
            `Vehicle ${vehicle.code} already has active trip ${active.state.tripId}`,
          );
        }
        return tx.createTrip({
          routeId: route.id,
          vehicleId: vehicle.id,
          startMode: input.mode,
          startedAt: this.deps.clock.now(),
        });
      }),
    );
    publishAll(this.deps.events, [{ name: 'trip.started', payload: tripStarted(trip) }]);
    return trip;
  }

  /** Ends an active trip by hand; it is recorded as aborted with the given reason. */
  async endTrip(tripId: string, reason: TripEndReason = 'manual'): Promise<TripRecord> {
    const ended = await this.deps.store.transaction(async (tx) => {
      const trip = await tx.lockTrip(tripId);
      if (trip === null) throw new TripLifecycleError('trip_not_found', `Trip ${tripId} not found`);
      if (trip.state.status !== 'active') {
        throw new TripLifecycleError('trip_not_active', `Trip ${tripId} is ${trip.state.status}`);
      }
      const next: TripRecord = {
        ...trip,
        state: abortTrip(trip.state, this.deps.clock.now()),
        endReason: reason,
      };
      await tx.saveTrip(next);
      return next;
    });
    publishAll(this.deps.events, [{ name: 'trip.completed', payload: tripEnded(ended) }]);
    return ended;
  }

  /** Aborts every active trip without fixes for longer than the inactivity timeout. */
  async closeInactiveTrips(): Promise<TripRecord[]> {
    const now = this.deps.clock.now();
    const cutoff = new Date(now.getTime() - this.deps.inactivityTimeoutSec * 1000);
    const closed = await this.deps.store.transaction(async (tx) => {
      const candidates = await tx.lockTripsWithoutFixesSince(cutoff);
      const ended: TripRecord[] = [];
      for (const trip of candidates) {
        const lastActivity = trip.state.lastFixAt ?? trip.startedAt;
        if (!isInactive(lastActivity, now, this.deps.inactivityTimeoutSec)) continue;
        const next: TripRecord = {
          ...trip,
          state: abortTrip(trip.state, now),
          endReason: 'inactivity',
        };
        await tx.saveTrip(next);
        ended.push(next);
      }
      return ended;
    });
    const events: PendingEvent[] = closed.map((trip) => ({
      name: 'trip.completed',
      payload: tripEnded(trip),
    }));
    publishAll(this.deps.events, events);
    for (const trip of closed) {
      this.deps.logger.info({ tripId: trip.state.tripId }, 'Trip aborted after inactivity');
    }
    return closed;
  }
}
