import type { LocatedReferencePoint } from '../../routes/domain/route.js';
import {
  projectOntoRoute,
  type ChainageWindow,
  type RouteGeometry,
} from '../../routes/domain/route-geometry.js';
import type { PositionFix } from './position-fix.js';
import { DEFAULT_TRACKING_SETTINGS, type TrackingSettings } from './tracking-settings.js';
import type { TripState } from './trip.js';

export interface TrackedRoute {
  readonly geometry: RouteGeometry;
  readonly points: readonly LocatedReferencePoint[];
}

export type TripEvent =
  | { readonly type: 'fix_ignored'; readonly reason: 'invalid' | 'out_of_order' | 'trip_closed' }
  | { readonly type: 'off_route'; readonly at: Date; readonly offsetMeters: number }
  | { readonly type: 'route_rejoined'; readonly at: Date }
  | { readonly type: 'jump_rejected'; readonly at: Date; readonly chainage: number }
  | {
      readonly type: 'point_passed';
      readonly pointId: string;
      readonly passedAt: Date;
      readonly precision: 'interpolated' | 'upper_bound';
    }
  | { readonly type: 'trip_completed'; readonly at: Date };

export interface TripUpdate {
  readonly state: TripState;
  readonly events: readonly TripEvent[];
}

/**
 * Applies one position fix to a trip and returns the new state plus what happened.
 *
 * - Invalid, out-of-order and duplicate fixes are ignored, as is every fix of a closed trip.
 * - The fix is matched only within a chainage window around the current progress
 *   (`[progress - backTolerance, progress + maxPlausibleSpeed * dt + slack]`), which keeps
 *   self-overlapping routes unambiguous and bounds how far one fix can move the truck.
 * - A fix farther than the off-route threshold does not move progress. If it lies on the route but
 *   outside the window, it is reported as an implausible jump instead.
 * - Progress is monotonic. Each reference point is passed once, at a time interpolated by chainage
 *   between the previous on-route fix and this one.
 */
export function advanceTrip(
  state: TripState,
  fix: PositionFix,
  route: TrackedRoute,
  settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS,
): TripUpdate {
  if (state.status !== 'active') return ignored(state, 'trip_closed');
  if (!fix.valid) return ignored(state, 'invalid');
  if (state.lastFixAt !== null && fix.fixTime.getTime() <= state.lastFixAt.getTime()) {
    return ignored(state, 'out_of_order');
  }

  const window = plausibleWindow(state, fix.fixTime, settings);
  const match = projectOntoRoute(route.geometry, fix, window);
  if (match === null || match.offsetMeters > settings.offRouteThresholdMeters) {
    return rejectFix(state, fix, route, settings);
  }

  const progressChainage = Math.max(state.progressChainage, match.chainage);
  const events: TripEvent[] = [];
  if (state.offRoute) events.push({ type: 'route_rejoined', at: fix.fixTime });

  const passes = detectPasses(state, progressChainage, fix.fixTime, route.points, settings);
  events.push(...passes);

  let next: TripState = {
    ...state,
    progressChainage,
    progressAt: fix.fixTime,
    lastFixAt: fix.fixTime,
    offRoute: false,
    passedPointIds: [...state.passedPointIds, ...passes.map((pass) => pass.pointId)],
  };
  if (progressChainage >= route.geometry.lengthMeters - settings.endToleranceMeters) {
    next = { ...next, status: 'completed', endedAt: fix.fixTime };
    events.push({ type: 'trip_completed', at: fix.fixTime });
  }
  return { state: next, events };
}

type PointPassed = Extract<TripEvent, { type: 'point_passed' }>;

function ignored(
  state: TripState,
  reason: Extract<TripEvent, { type: 'fix_ignored' }>['reason'],
): TripUpdate {
  return { state, events: [{ type: 'fix_ignored', reason }] };
}

function plausibleWindow(state: TripState, at: Date, settings: TrackingSettings): ChainageWindow {
  const from = state.progressChainage - settings.backToleranceMeters;
  if (state.progressAt === null) return { from, to: Number.POSITIVE_INFINITY };
  const elapsedSec = (at.getTime() - state.progressAt.getTime()) / 1000;
  const maxAdvance = settings.maxPlausibleSpeedMps * elapsedSec + settings.advanceSlackMeters;
  return { from, to: state.progressChainage + maxAdvance };
}

function rejectFix(
  state: TripState,
  fix: PositionFix,
  route: TrackedRoute,
  settings: TrackingSettings,
): TripUpdate {
  const anywhere = projectOntoRoute(route.geometry, fix);
  if (anywhere !== null && anywhere.offsetMeters <= settings.offRouteThresholdMeters) {
    return {
      state: { ...state, lastFixAt: fix.fixTime },
      events: [{ type: 'jump_rejected', at: fix.fixTime, chainage: anywhere.chainage }],
    };
  }
  const offsetMeters = anywhere?.offsetMeters ?? Number.POSITIVE_INFINITY;
  return {
    state: { ...state, lastFixAt: fix.fixTime, offRoute: true },
    events: state.offRoute ? [] : [{ type: 'off_route', at: fix.fixTime, offsetMeters }],
  };
}

function detectPasses(
  state: TripState,
  progressChainage: number,
  at: Date,
  points: readonly LocatedReferencePoint[],
  settings: TrackingSettings,
): PointPassed[] {
  const passed = new Set(state.passedPointIds);
  return points
    .filter((point) => !passed.has(point.id))
    .filter((point) => progressChainage >= point.chainage - settings.passToleranceMeters)
    .sort((a, b) => a.chainage - b.chainage)
    .map((point) =>
      state.progressAt === null
        ? { type: 'point_passed', pointId: point.id, passedAt: at, precision: 'upper_bound' }
        : {
            type: 'point_passed',
            pointId: point.id,
            passedAt: interpolateTime(
              { chainage: state.progressChainage, at: state.progressAt },
              { chainage: progressChainage, at },
              point.chainage,
            ),
            precision: 'interpolated',
          },
    );
}

/** Time at which progress reached `chainage`, linearly between two samples (clamped to them). */
function interpolateTime(
  previous: { chainage: number; at: Date },
  current: { chainage: number; at: Date },
  chainage: number,
): Date {
  const distance = current.chainage - previous.chainage;
  if (distance <= 0) return current.at;
  const fraction = Math.min(1, Math.max(0, (chainage - previous.chainage) / distance));
  const t0 = previous.at.getTime();
  return new Date(Math.round(t0 + fraction * (current.at.getTime() - t0)));
}
