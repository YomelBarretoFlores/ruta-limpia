import type { PathOptions } from 'leaflet';

import { MAP_COLORS } from '../../shared/map/truck-icon';

/** The planned route: a 6 px accent line over a 9 px white casing (the design system's route). */
const PLANNED = {
  casing: { color: MAP_COLORS.surface, weight: 9, opacity: 1, lineCap: 'round' },
  line: { color: MAP_COLORS.accent, weight: 6, opacity: 1, lineCap: 'round' },
} as const satisfies Record<string, PathOptions>;

/**
 * Under a recorded GPS track the planned route steps back: a thinner, lighter accent line, so the
 * solid ink track on top reads as the trip and the route as its reference.
 */
const PLANNED_UNDER_TRACK = {
  casing: { color: MAP_COLORS.surface, weight: 7, opacity: 1, lineCap: 'round' },
  line: { color: MAP_COLORS.accent, weight: 4, opacity: 0.35, lineCap: 'round' },
} as const satisfies Record<string, PathOptions>;

export function plannedRouteStyle(underTrack: boolean) {
  return underTrack ? PLANNED_UNDER_TRACK : PLANNED;
}

/** A recorded trip: a solid 3 px ink line, with a small ink dot at each valid GPS position. */
export const TRACK_LINE = {
  color: MAP_COLORS.ink,
  weight: 3,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
} as const satisfies PathOptions;
export const TRACK_VERTEX = {
  color: MAP_COLORS.ink,
  weight: 1,
  fillColor: MAP_COLORS.ink,
  fillOpacity: 1,
} as const satisfies PathOptions;
export const TRACK_VERTEX_RADIUS = 2;
