import type { LatLon } from '../../shared/domain/geo.js';

/** A collection route: an ordered polyline driven from its first vertex to its last. */
export interface Route {
  readonly id: string;
  /** Public route code, for example `RI-01`. */
  readonly code: string;
  readonly name: string;
  readonly polyline: readonly LatLon[];
}

/** A public reference point households subscribe to, for example `P01`. */
export interface ReferencePoint {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Declared order along the route (1-based). */
  readonly sequence: number;
  readonly lat: number;
  readonly lon: number;
}

/** A reference point referenced linearly onto its route. */
export interface LocatedReferencePoint extends ReferencePoint {
  /** Distance along the route, in meters from the first vertex. */
  readonly chainage: number;
  /** Lateral distance from the route line, in meters. */
  readonly offsetMeters: number;
}

export interface RouteSettings {
  /** A reference point farther than this from the route line is rejected. */
  readonly maxPointOffsetMeters: number;
}

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = Object.freeze({
  maxPointOffsetMeters: 50,
});
