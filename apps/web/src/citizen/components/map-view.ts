import type { FitBoundsOptions } from 'leaflet';

/** Room around the route, so the end points and their labels are not cut by the map's edge. */
export const FIT_OPTIONS: FitBoundsOptions = Object.freeze({
  padding: [24, 24],
  maxZoom: 17,
}) as FitBoundsOptions;

/** Neighborhood to street level: the whole 1.3 km route fits, a single block is the closest. */
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 18;
