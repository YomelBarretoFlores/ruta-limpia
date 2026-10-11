import type { SpeedProfileProvider } from '../../eta/application/speed-profile-provider.js';
import { estimateEtas } from '../../eta/domain/eta-estimator.js';
import type { EtaSettings } from '../../eta/domain/eta-settings.js';
import type { SpeedProfile } from '../../eta/domain/speed-profile.js';
import type { RouteCatalog, RouteSnapshot } from '../../routes/application/route-catalog.js';
import type { PublicRouteQueries } from '../../routes/application/public-route-queries.js';
import type { Clock } from '../../shared/application/clock.js';
import type { Logger } from '../../shared/application/logger.js';
import type { LiveRouteReadModel } from './live-ports.js';
import { toLiveTripView, type LiveRouteSnapshotView } from './live-views.js';

export interface LiveSnapshotDependencies {
  readonly routeIds: Pick<PublicRouteQueries, 'findActiveIdByCode'>;
  readonly routes: RouteCatalog;
  readonly readModel: LiveRouteReadModel;
  readonly profiles: SpeedProfileProvider;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly etaSettings: EtaSettings;
}

/**
 * Builds the live snapshot of a route: its active trips with the truck position, the telemetry
 * signal, passes, alerts, and every point's ETA recomputed at the current time from the persisted
 * trip state (so staleness shows even between fixes). Read-only: it never records anything and
 * never emits alerts.
 */
export class LiveSnapshotService {
  constructor(private readonly deps: LiveSnapshotDependencies) {}

  /** The active route with this public code (already upper-cased), or null. */
  async findRoute(code: string): Promise<RouteSnapshot | null> {
    const routeId = await this.deps.routeIds.findActiveIdByCode(code);
    if (routeId === null) return null;
    const route = await this.deps.routes.get(routeId);
    return route?.active === true ? route : null;
  }

  async snapshot(route: RouteSnapshot): Promise<LiveRouteSnapshotView> {
    const { clock, etaSettings } = this.deps;
    const trips = await this.deps.readModel.activeTrips(route.id);
    const now = clock.now();
    const profile = trips.length === 0 ? null : await this.loadProfile(route.id);
    return {
      route: { code: route.code, name: route.name },
      generatedAt: now.toISOString(),
      staleAfterSeconds: etaSettings.maxFixAgeSec,
      trips: trips.map((live) =>
        toLiveTripView({
          live,
          route,
          etas: estimateEtas(
            {
              now,
              trip: live.trip.state,
              points: route.points,
              recentSpeedMps: live.trip.recentSpeed.speedMps,
              profile,
            },
            etaSettings,
          ),
          now,
          maxFixAgeSec: etaSettings.maxFixAgeSec,
        }),
      ),
    };
  }

  /** The snapshot of the active route with this code, or null when there is none. */
  async snapshotByCode(code: string): Promise<LiveRouteSnapshotView | null> {
    const route = await this.findRoute(code);
    return route === null ? null : this.snapshot(route);
  }

  private async loadProfile(routeId: string): Promise<SpeedProfile | null> {
    try {
      return await this.deps.profiles.forRoute(routeId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, routeId },
        'Historical speed profile unavailable; live ETAs use recent speed only',
      );
      return null;
    }
  }
}
