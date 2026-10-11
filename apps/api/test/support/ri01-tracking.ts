import { RI01_REFERENCE_POINTS, RI01_ROUTE } from '../../src/routes/domain/ri01.fixture.js';
import { locateReferencePoints } from '../../src/routes/domain/reference-points.js';
import { buildRouteGeometry, positionAtChainage } from '../../src/routes/domain/route-geometry.js';
import type { RouteSnapshot } from '../../src/routes/application/route-catalog.js';
import type { LatLon } from '../../src/shared/domain/geo.js';

export const RI01_GEOMETRY = buildRouteGeometry(RI01_ROUTE.polyline);

export const RI01_SNAPSHOT: RouteSnapshot = {
  id: 'route-ri-01',
  code: RI01_ROUTE.code,
  name: RI01_ROUTE.name,
  active: true,
  geometry: RI01_GEOMETRY,
  points: locateReferencePoints(RI01_GEOMETRY, RI01_REFERENCE_POINTS),
};

/** The position at `chainage` along RI-01, optionally shifted east by `eastMeters`. */
export function ri01PositionAt(chainage: number, eastMeters = 0): LatLon {
  const p = positionAtChainage(RI01_GEOMETRY, chainage);
  return { lat: p.lat, lon: p.lon + eastMeters / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

/** True chainage `seconds` into a stop-and-go run on RI-01: 40 s at 1.5 m/s, then 40 s stopped. */
export function stopAndGoChainageAt(seconds: number): number {
  const cycle = Math.floor(seconds / 80);
  const moving = Math.min(seconds - cycle * 80, 40);
  return Math.min(RI01_GEOMETRY.lengthMeters, (cycle * 40 + moving) * 1.5);
}
