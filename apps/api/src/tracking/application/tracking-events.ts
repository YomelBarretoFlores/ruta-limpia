import type { PointEta } from '../../eta/domain/eta-estimator.js';
import type { TripStatus } from '../domain/trip.js';
import type { TripEndReason, TripStartMode } from './ports.js';

/**
 * In-process events published after each committed tracking change (consumed by the SSE stream).
 * Payloads are plain data; dates are `Date` objects.
 */
export interface TrackingEvents {
  'vehicle.position': {
    readonly vehicleId: string;
    readonly vehicleCode: string;
    readonly tripId: string | null;
    readonly fixTime: Date;
    readonly lat: number;
    readonly lon: number;
    readonly speedKmh: number;
    readonly course: number | null;
    readonly valid: boolean;
  };
  'trip.started': {
    readonly tripId: string;
    readonly routeId: string;
    readonly vehicleId: string;
    readonly startMode: TripStartMode;
    readonly startedAt: Date;
  };
  'trip.updated': {
    readonly tripId: string;
    readonly routeId: string;
    readonly vehicleId: string;
    readonly progressChainage: number;
    readonly progressAt: Date | null;
    readonly lastFixAt: Date | null;
    readonly offRoute: boolean;
    readonly passedPointIds: readonly string[];
  };
  /** A trip ended: `completed` at the route end, or `aborted` (inactivity, operator). */
  'trip.completed': {
    readonly tripId: string;
    readonly routeId: string;
    readonly vehicleId: string;
    readonly status: Exclude<TripStatus, 'active'>;
    readonly endedAt: Date;
    readonly endReason: TripEndReason;
  };
  'point.passed': {
    readonly tripId: string;
    readonly routeId: string;
    readonly pointId: string;
    readonly passedAt: Date;
    readonly precision: 'interpolated' | 'upper_bound';
  };
  /** ETAs of every point of an active trip; `stale` entries carry no prediction by construction. */
  'eta.updated': {
    readonly tripId: string;
    readonly routeId: string;
    readonly vehicleId: string;
    readonly computedAt: Date;
    readonly etas: readonly PointEta[];
  };
  'alert.emitted': {
    readonly alertId: string;
    readonly tripId: string;
    readonly routeId: string;
    readonly pointId: string;
    readonly emittedAt: Date;
    readonly communicatedPredictedPassAt: Date;
    readonly secondsRemainingAtEmission: number;
    readonly insideTargetWindow: boolean;
  };
}

export type TrackingEventName = keyof TrackingEvents;

/** An event waiting to be published once its transaction commits. */
export type PendingEvent = {
  [K in TrackingEventName]: { readonly name: K; readonly payload: TrackingEvents[K] };
}[TrackingEventName];
