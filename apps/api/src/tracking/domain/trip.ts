import { DEFAULT_TRACKING_SETTINGS } from './tracking-settings.js';

export type TripStatus = 'active' | 'completed' | 'aborted';

/** Immutable snapshot of one vehicle's run along one route. */
export interface TripState {
  readonly tripId: string;
  readonly status: TripStatus;
  /** Monotonic distance along the route reached so far, in meters. */
  readonly progressChainage: number;
  /** Time of the last on-route fix, when progress was last measured; null before the first one. */
  readonly progressAt: Date | null;
  /** Time of the last processed fix, on or off route. */
  readonly lastFixAt: Date | null;
  readonly offRoute: boolean;
  /** Reference points already passed in this trip, in pass order. */
  readonly passedPointIds: readonly string[];
  readonly endedAt: Date | null;
}

export function startTrip(tripId: string): TripState {
  return {
    tripId,
    status: 'active',
    progressChainage: 0,
    progressAt: null,
    lastFixAt: null,
    offRoute: false,
    passedPointIds: [],
    endedAt: null,
  };
}

/** Closes an active trip as aborted (for example after inactivity). Closed trips stay unchanged. */
export function abortTrip(state: TripState, at: Date): TripState {
  if (state.status !== 'active') return state;
  return { ...state, status: 'aborted', endedAt: at };
}

/** True when no fix arrived for longer than the timeout. */
export function isInactive(
  lastFixAt: Date,
  now: Date,
  timeoutSec: number = DEFAULT_TRACKING_SETTINGS.inactivityTimeoutSec,
): boolean {
  return now.getTime() - lastFixAt.getTime() > timeoutSec * 1000;
}
