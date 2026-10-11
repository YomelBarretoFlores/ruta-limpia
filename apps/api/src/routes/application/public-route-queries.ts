/** An active route in the public catalog. */
export interface RouteSummary {
  readonly code: string;
  readonly name: string;
  readonly district: string;
  readonly lengthMeters: number;
  readonly pointCount: number;
}

/** A public reference point with its position along the route. */
export interface RouteDetailPoint {
  readonly code: string;
  readonly name: string;
  readonly sequence: number;
  readonly lat: number;
  readonly lon: number;
  /** Distance along the route from its start, in meters. */
  readonly chainageMeters: number;
  /** The operators observe the truck's music notice at this point (Instrument 2). */
  readonly observesMusic: boolean;
}

/** The planned start of the route on one weekday, in the pilot's local time (America/Lima). */
export interface PlannedStart {
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
  /** `HH:MM`, local time. */
  readonly plannedStart: string;
}

/** Everything the citizen map and the printed-schedule fallback need about one route. */
export interface RouteDetail extends RouteSummary {
  /** The polyline as `[lon, lat]` pairs (GeoJSON order), from the route start to its end. */
  readonly coordinates: readonly (readonly [number, number])[];
  readonly points: readonly RouteDetailPoint[];
  readonly schedule: readonly PlannedStart[];
}

/** Port: read-only queries over the active public catalog (inactive routes and points are hidden). */
export interface PublicRouteQueries {
  listActive(): Promise<RouteSummary[]>;
  /** The route with this code, or null when it does not exist or is inactive. */
  findActiveByCode(code: string): Promise<RouteDetail | null>;
  /** The id of the active route with this code, or null. */
  findActiveIdByCode(code: string): Promise<string | null>;
}
