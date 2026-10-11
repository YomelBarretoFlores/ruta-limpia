import {
  createLocalProjection,
  projectOntoSegment,
  type LatLon,
  type LocalProjection,
  type PlanarPoint,
} from '../../shared/domain/geo.js';
import { RouteValidationError } from './route-validation-error.js';

/**
 * A route polyline prepared for linear referencing: vertices in a local planar frame and the
 * cumulative chainage (meters along the route) at every vertex.
 */
export interface RouteGeometry {
  readonly lengthMeters: number;
  readonly projection: LocalProjection;
  readonly vertices: readonly PlanarPoint[];
  /** `chainages[i]` is the distance along the route at `vertices[i]`. */
  readonly chainages: readonly number[];
}

/** Closed chainage interval, in meters, that restricts which part of the route may match. */
export interface ChainageWindow {
  readonly from: number;
  readonly to: number;
}

/** Where a position falls on the route. */
export interface RouteProjection {
  readonly chainage: number;
  readonly offsetMeters: number;
}

export function buildRouteGeometry(polyline: readonly LatLon[]): RouteGeometry {
  if (polyline.length < 2) {
    throw new RouteValidationError('degenerate_route', 'A route needs at least two vertices.');
  }
  const projection = createLocalProjection(boundingBoxCenter(polyline));
  const vertices = polyline.map((p) => projection.toPlanar(p));
  const chainages = [0];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    chainages.push(chainages[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const lengthMeters = chainages[chainages.length - 1]!;
  if (lengthMeters === 0) {
    throw new RouteValidationError('degenerate_route', 'A route must have a positive length.');
  }
  return Object.freeze({ lengthMeters, projection, vertices, chainages });
}

/**
 * Projects a position onto the route, considering only the part inside `window` (the whole route by
 * default). Returns the closest candidate, preferring the lower chainage on ties, or `null` when the
 * window does not overlap the route.
 */
export function projectOntoRoute(
  geometry: RouteGeometry,
  position: LatLon,
  window: ChainageWindow = { from: 0, to: geometry.lengthMeters },
): RouteProjection | null {
  const p = geometry.projection.toPlanar(position);
  let best: RouteProjection | null = null;
  for (let i = 1; i < geometry.vertices.length; i++) {
    const start = geometry.chainages[i - 1]!;
    const end = geometry.chainages[i]!;
    const length = end - start;
    if (length === 0 || end < window.from || start > window.to) continue;
    const range = {
      min: Math.max(0, (window.from - start) / length),
      max: Math.min(1, (window.to - start) / length),
    };
    const candidate = projectOntoSegment(
      p,
      geometry.vertices[i - 1]!,
      geometry.vertices[i]!,
      range,
    );
    if (best === null || candidate.distance < best.offsetMeters) {
      best = { chainage: start + candidate.t * length, offsetMeters: candidate.distance };
    }
  }
  return best;
}

/** The position on the route at the given chainage, clamped to the route ends. */
export function positionAtChainage(geometry: RouteGeometry, chainage: number): LatLon {
  const target = Math.min(geometry.lengthMeters, Math.max(0, chainage));
  let i = 1;
  while (i < geometry.chainages.length - 1 && geometry.chainages[i]! < target) i++;
  const start = geometry.chainages[i - 1]!;
  const length = geometry.chainages[i]! - start;
  const t = length === 0 ? 0 : (target - start) / length;
  const a = geometry.vertices[i - 1]!;
  const b = geometry.vertices[i]!;
  return geometry.projection.toLatLon({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function boundingBoxCenter(polyline: readonly LatLon[]): LatLon {
  const lats = polyline.map((p) => p.lat);
  const lons = polyline.map((p) => p.lon);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}
