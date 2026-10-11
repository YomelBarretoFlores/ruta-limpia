import type { FitBoundsOptions } from 'leaflet';

/** Room around the route, so the end points and their labels are not cut by the map's edge. */
export const FIT_OPTIONS: FitBoundsOptions = Object.freeze({
  padding: [24, 24],
  maxZoom: 17,
}) as FitBoundsOptions;

/** Neighborhood to street level: the whole 1.3 km route fits, a single block is the closest. */
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 18;
/**
 * Quarter zoom levels: a long, narrow route fills a short map instead of dropping a whole level
 * (on a 280 px phone map RI-01 would otherwise use less than half the height).
 */
export const ZOOM_SNAP = 0.25;

/** What the map needs of a route: its line (`[lon, lat]` pairs) and its reference points. */
export interface RouteShape {
  readonly geometry: { readonly coordinates: readonly (readonly [number, number])[] };
  readonly points: readonly { readonly lat: number; readonly lon: number }[];
}
