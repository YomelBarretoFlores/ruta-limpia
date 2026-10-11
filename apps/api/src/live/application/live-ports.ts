import type { RecordedPass, TripRecord } from '../../tracking/application/ports.js';

/** The alert of one point in a trip (at most one per trip and point), with its delivery counts. */
export interface LiveAlert {
  readonly pointId: string;
  readonly emittedAt: Date;
  readonly communicatedPredictedPassAt: Date;
  readonly recipients: number;
  readonly delivered: number;
}

/** An active trip with what the live views show around it. */
export interface LiveTrip {
  readonly trip: TripRecord;
  readonly vehicle: { readonly code: string; readonly label: string };
  /** The last position received for this trip, on or off route; null before the first fix. */
  readonly lastPosition: {
    readonly lat: number;
    readonly lon: number;
    readonly fixTime: Date;
  } | null;
  readonly passes: readonly RecordedPass[];
  readonly alerts: readonly LiveAlert[];
}

/** Port: read-only access to the live state of a route. */
export interface LiveRouteReadModel {
  /** Active trips on the route, oldest first. */
  activeTrips(routeId: string): Promise<LiveTrip[]>;
}
