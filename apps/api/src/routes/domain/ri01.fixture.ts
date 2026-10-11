/**
 * Route RI-01 (Av. Centenario, Independencia, Huaraz) with its candidate public reference points
 * P01–P15 from the proposal (Annex 8), in WGS84 decimal degrees.
 *
 * Shared fixture: domain tests use it today, and the seed data and the simulator reuse the same
 * coordinates so every layer talks about the same route. The polyline runs through every point and is
 * extended about 30 m before P01 and after P15, along the first and last legs.
 */
import type { LatLon } from '../../shared/domain/geo.js';
import type { ReferencePoint, Route } from './route.js';

export const RI01_POINT_COORDINATES: readonly LatLon[] = [
  { lat: -9.523207, lon: -77.528621 },
  { lat: -9.522446, lon: -77.528825 },
  { lat: -9.521682, lon: -77.529011 },
  { lat: -9.520917, lon: -77.529199 },
  { lat: -9.520155, lon: -77.529403 },
  { lat: -9.519397, lon: -77.529618 },
  { lat: -9.518638, lon: -77.529834 },
  { lat: -9.517875, lon: -77.530031 },
  { lat: -9.517116, lon: -77.530247 },
  { lat: -9.516359, lon: -77.530466 },
  { lat: -9.515597, lon: -77.530669 },
  { lat: -9.514842, lon: -77.530895 },
  { lat: -9.514133, lon: -77.53124 },
  { lat: -9.513441, lon: -77.531621 },
  { lat: -9.512746, lon: -77.531997 },
];

/** About 30 m before P01, along the P02→P01 direction. */
const RI01_START: LatLon = { lat: -9.523468, lon: -77.52855 };
/** About 30 m after P15, along the P14→P15 direction. */
const RI01_END: LatLon = { lat: -9.512508, lon: -77.532126 };

export const RI01_ROUTE: Route = {
  id: 'route-ri-01',
  code: 'RI-01',
  name: 'Av. Centenario (Independencia)',
  polyline: [RI01_START, ...RI01_POINT_COORDINATES, RI01_END],
};

export const RI01_REFERENCE_POINTS: readonly ReferencePoint[] = RI01_POINT_COORDINATES.map(
  (position, index) => {
    const code = `P${String(index + 1).padStart(2, '0')}`;
    return {
      id: `point-ri-01-${code.toLowerCase()}`,
      code,
      name: `Reference point ${code}`,
      sequence: index + 1,
      lat: position.lat,
      lon: position.lon,
    };
  },
);
