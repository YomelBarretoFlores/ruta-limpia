import type { RouteSnapshot } from '../../routes/application/route-catalog.js';
import type { LiveRouteSnapshotView, LiveTripView } from './live-views.js';
import { toPanelPoints, type PanelPointView, type PointDeliveryStats } from './panel-live-views.js';

/** An unresolved incident of the route, as the live panel shows it. */
export interface OpenIncident {
  readonly id: string;
  readonly kind: string;
  readonly tripId: string | null;
  readonly pointCode: string | null;
  readonly description: string;
  readonly occurredAt: Date;
}

/** Port: what the live panel adds to the public snapshot. */
export interface PanelLiveReadModel {
  deliveryStats(tripIds: readonly string[]): Promise<PointDeliveryStats[]>;
  openIncidents(routeId: string): Promise<OpenIncident[]>;
}

export interface PanelLiveSnapshot extends Omit<LiveRouteSnapshotView, 'trips'> {
  readonly trips: readonly (LiveTripView & { readonly points: readonly PanelPointView[] })[];
  readonly openIncidents: readonly OpenIncident[];
}

export interface PanelLiveDependencies {
  readonly snapshots: {
    findRoute(code: string): Promise<RouteSnapshot | null>;
    snapshot(route: RouteSnapshot): Promise<LiveRouteSnapshotView>;
  };
  readonly readModel: PanelLiveReadModel;
}

/**
 * The supervisor's live view of a route: the public snapshot, plus per trip the pass table with
 * each point's alert status and push delivery, plus the route's open incidents.
 */
export class PanelLiveService {
  constructor(private readonly deps: PanelLiveDependencies) {}

  async snapshotByCode(code: string): Promise<PanelLiveSnapshot | null> {
    const route = await this.deps.snapshots.findRoute(code);
    if (route === null) return null;
    const snapshot = await this.deps.snapshots.snapshot(route);
    const [stats, openIncidents] = await Promise.all([
      this.deps.readModel.deliveryStats(snapshot.trips.map((trip) => trip.tripId)),
      this.deps.readModel.openIncidents(route.id),
    ]);
    return {
      ...snapshot,
      trips: snapshot.trips.map((trip) => ({ ...trip, points: toPanelPoints(trip, route, stats) })),
      openIncidents,
    };
  }
}
