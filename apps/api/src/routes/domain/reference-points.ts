import {
  DEFAULT_ROUTE_SETTINGS,
  type LocatedReferencePoint,
  type ReferencePoint,
  type RouteSettings,
} from './route.js';
import { projectOntoRoute, type RouteGeometry } from './route-geometry.js';
import { RouteValidationError } from './route-validation-error.js';

/**
 * Computes each reference point's chainage and lateral offset on the route, in declared order.
 *
 * Each point is matched to its nearest place on the whole route, then the chainages must strictly
 * increase with the declared sequence. On a route that overlaps itself, a point on the shared stretch
 * is ambiguous; such routes need their points placed off the overlap.
 */
export function locateReferencePoints(
  geometry: RouteGeometry,
  points: readonly ReferencePoint[],
  settings: RouteSettings = DEFAULT_ROUTE_SETTINGS,
): LocatedReferencePoint[] {
  const ordered = [...points].sort((a, b) => a.sequence - b.sequence);
  const located: LocatedReferencePoint[] = [];
  for (const point of ordered) {
    const match = projectOntoRoute(geometry, point)!;
    if (match.offsetMeters > settings.maxPointOffsetMeters) {
      throw new RouteValidationError(
        'point_off_route',
        `Point ${point.code} is ${match.offsetMeters.toFixed(1)} m from the route (max ${settings.maxPointOffsetMeters} m).`,
        point.id,
      );
    }
    const previous = located[located.length - 1];
    if (previous !== undefined && match.chainage <= previous.chainage) {
      throw new RouteValidationError(
        'point_order_mismatch',
        `Point ${point.code} lies before ${previous.code} along the route, contradicting its sequence.`,
        point.id,
      );
    }
    located.push({ ...point, chainage: match.chainage, offsetMeters: match.offsetMeters });
  }
  return located;
}
