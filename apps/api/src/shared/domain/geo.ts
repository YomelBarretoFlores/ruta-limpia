/** A WGS84 position in decimal degrees. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** A point in a local planar frame, in meters (x east, y north). */
export interface PlanarPoint {
  readonly x: number;
  readonly y: number;
}

/** Mean Earth radius (IUGG), in meters. */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Great-circle distance between two positions, in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Equirectangular projection around a fixed origin. Accurate to well under 0.1% within a few
 * kilometers, which is enough for linear referencing at city scale.
 */
export interface LocalProjection {
  readonly origin: LatLon;
  toPlanar(position: LatLon): PlanarPoint;
  toLatLon(point: PlanarPoint): LatLon;
}

export function createLocalProjection(origin: LatLon): LocalProjection {
  const metersPerRadianLat = EARTH_RADIUS_M;
  const metersPerRadianLon = EARTH_RADIUS_M * Math.cos(toRadians(origin.lat));
  return Object.freeze({
    origin,
    toPlanar: (position: LatLon): PlanarPoint => ({
      x: toRadians(position.lon - origin.lon) * metersPerRadianLon,
      y: toRadians(position.lat - origin.lat) * metersPerRadianLat,
    }),
    toLatLon: (point: PlanarPoint): LatLon => ({
      lat: origin.lat + toDegrees(point.y / metersPerRadianLat),
      lon: origin.lon + toDegrees(point.x / metersPerRadianLon),
    }),
  });
}

/** Result of projecting a point onto a segment: parameter `t` in [0, 1], distance and foot point. */
export interface SegmentProjection {
  readonly t: number;
  readonly distance: number;
  readonly point: PlanarPoint;
}

/** Closed range for the segment parameter `t`, used to restrict a projection to part of a segment. */
export interface ParameterRange {
  readonly min: number;
  readonly max: number;
}

const FULL_SEGMENT: ParameterRange = { min: 0, max: 1 };

/** Orthogonal projection of `p` onto segment `a`→`b`, clamped to the given parameter range. */
export function projectOntoSegment(
  p: PlanarPoint,
  a: PlanarPoint,
  b: PlanarPoint,
  range: ParameterRange = FULL_SEGMENT,
): SegmentProjection {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const unclamped = lengthSquared === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const t = Math.min(range.max, Math.max(range.min, unclamped));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, distance: Math.hypot(p.x - point.x, p.y - point.y), point };
}
