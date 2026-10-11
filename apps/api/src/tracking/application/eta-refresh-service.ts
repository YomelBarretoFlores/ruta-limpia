import type { SpeedProfileProvider } from '../../eta/application/speed-profile-provider.js';
import { estimateEtas } from '../../eta/domain/eta-estimator.js';
import type { EtaSettings } from '../../eta/domain/eta-settings.js';
import type { SpeedProfile } from '../../eta/domain/speed-profile.js';
import type { RouteCatalog, RouteSnapshot } from '../../routes/application/route-catalog.js';
import type { Clock } from '../../shared/application/clock.js';
import type { EventBus } from '../../shared/application/event-bus.js';
import type { KeyedMutex } from '../../shared/application/keyed-mutex.js';
import type { Logger } from '../../shared/application/logger.js';
import type { TripReader, TripRecord } from './ports.js';
import type { TrackingEvents } from './tracking-events.js';

export interface EtaRefreshDependencies {
  readonly trips: TripReader;
  readonly routes: RouteCatalog;
  readonly profiles: SpeedProfileProvider;
  readonly events: EventBus<TrackingEvents>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The tracking pipeline's mutex: a refresh never interleaves with a fix of the same vehicle. */
  readonly mutex: KeyedMutex;
  readonly settings: EtaSettings;
}

/**
 * Recomputes the ETAs of every active trip at the current time, from the persisted trip state, the
 * recent speed and the cached speed profile, and publishes them as `eta.updated`. Between fixes,
 * countdowns advance and stale telemetry suspends the predictions without waiting for the next fix.
 *
 * It only publishes: it never changes a trip and never emits alerts (alerts fire on fresh fixes,
 * in ingestion).
 */
export class EtaRefreshService {
  constructor(private readonly deps: EtaRefreshDependencies) {}

  /** Refreshes every active trip; returns how many `eta.updated` events were published. */
  async refreshAll(): Promise<number> {
    const trips = await this.deps.trips.activeTrips();
    let published = 0;
    for (const listed of trips) {
      try {
        if (await this.refreshVehicle(listed.vehicleId)) published++;
      } catch (error) {
        this.deps.logger.error(
          { err: error, tripId: listed.state.tripId, vehicleId: listed.vehicleId },
          'ETA refresh of a trip failed',
        );
      }
    }
    return published;
  }

  /**
   * Under the vehicle's lock, re-reads its active trip (a fix may have advanced or ended it since
   * the listing) and publishes its ETAs. Publishing inside the lock keeps the order with the
   * pipeline: an ingest that commits later also publishes later.
   */
  private refreshVehicle(vehicleId: string): Promise<boolean> {
    return this.deps.mutex.runExclusive(vehicleId, async () => {
      const trip = await this.deps.trips.activeTripOf(vehicleId);
      if (trip === null) return false;
      const route = await this.deps.routes.get(trip.routeId);
      if (route === null) {
        this.deps.logger.debug(
          { tripId: trip.state.tripId, routeId: trip.routeId },
          'ETA refresh skipped: the trip route is missing',
        );
        return false;
      }
      this.publish(trip, route, await this.loadProfile(trip.routeId));
      return true;
    });
  }

  private publish(trip: TripRecord, route: RouteSnapshot, profile: SpeedProfile | null): void {
    const now = this.deps.clock.now();
    const etas = estimateEtas(
      {
        now,
        trip: trip.state,
        points: route.points,
        recentSpeedMps: trip.recentSpeed.speedMps,
        profile,
      },
      this.deps.settings,
    );
    this.deps.events.publish('eta.updated', {
      tripId: trip.state.tripId,
      routeId: trip.routeId,
      vehicleId: trip.vehicleId,
      computedAt: now,
      lastFixAt: trip.state.lastFixAt,
      etas,
    });
  }

  private async loadProfile(routeId: string): Promise<SpeedProfile | null> {
    try {
      return await this.deps.profiles.forRoute(routeId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, routeId },
        'Historical speed profile unavailable; refreshed ETAs use recent speed only',
      );
      return null;
    }
  }
}
