import type { PointEta } from '../../eta/domain/eta-estimator.js';
import { etaDisplayWindow, type EtaDisplayWindow } from '../../eta/domain/eta-display-window.js';
import { telemetrySignal, type TelemetrySignal } from '../../eta/domain/staleness.js';
import type { RouteSnapshot } from '../../routes/application/route-catalog.js';
import { round1 } from '../../shared/domain/rounding.js';
import type { LiveTrip } from './live-ports.js';

/**
 * Public, JSON-ready views of the live state (dates as ISO strings, no internal ids beyond trip and
 * point ids, no subscription data). The HTTP snapshot and the SSE stream share them.
 */

/** A point's ETA. Only `live` entries carry a prediction; `stale` ones never do. */
export type EtaView =
  | {
      readonly pointId: string;
      readonly pointCode: string;
      readonly status: 'live';
      readonly predictedPassAt: string;
      readonly secondsRemaining: number;
      readonly window: EtaDisplayWindow;
    }
  | {
      readonly pointId: string;
      readonly pointCode: string;
      readonly status: 'stale' | 'passed' | 'not_started';
    };

export interface PassView {
  readonly pointId: string;
  readonly pointCode: string;
  readonly passedAt: string;
  readonly precision: 'interpolated' | 'upper_bound';
}

export interface AlertView {
  readonly pointId: string;
  readonly pointCode: string;
  readonly emittedAt: string;
  readonly communicatedPredictedPassAt: string;
  readonly recipients: number;
  readonly delivered: number;
}

export interface LiveTripView {
  readonly tripId: string;
  readonly startedAt: string;
  readonly startMode: 'auto' | 'manual';
  readonly vehicle: { readonly code: string; readonly label: string };
  readonly signal: TelemetrySignal;
  readonly lastFixAt: string | null;
  readonly lastPosition: {
    readonly lat: number;
    readonly lon: number;
    readonly fixTime: string;
  } | null;
  readonly progress: {
    readonly chainageMeters: number;
    readonly percent: number;
    readonly offRoute: boolean;
  };
  readonly etas: readonly EtaView[];
  readonly passes: readonly PassView[];
  readonly alerts: readonly AlertView[];
}

export interface LiveRouteSnapshotView {
  readonly route: { readonly code: string; readonly name: string };
  readonly generatedAt: string;
  /** Telemetry older than this is `stale`: the ETA is hidden and the printed schedule shown. */
  readonly staleAfterSeconds: number;
  /** Usually zero or one trip; several when more than one truck runs the route. */
  readonly trips: readonly LiveTripView[];
}

/** Point id → public code of the route's active points. */
export type PointCodes = ReadonlyMap<string, string>;

export function pointCodesOf(route: Pick<RouteSnapshot, 'points'>): PointCodes {
  return new Map(route.points.map((p) => [p.id, p.code]));
}

/**
 * Maps the domain ETAs to their public view. Seconds are rounded to whole seconds; points no longer
 * in the route (deactivated meanwhile) are left out.
 */
export function toEtaViews(etas: readonly PointEta[], codes: PointCodes): EtaView[] {
  return etas.flatMap((eta): EtaView[] => {
    const pointCode = codes.get(eta.pointId);
    if (pointCode === undefined) return [];
    if (eta.status !== 'live') return [{ pointId: eta.pointId, pointCode, status: eta.status }];
    const secondsRemaining = Math.round(eta.secondsRemaining);
    return [
      {
        pointId: eta.pointId,
        pointCode,
        status: 'live',
        predictedPassAt: eta.predictedPassAt.toISOString(),
        secondsRemaining,
        window: etaDisplayWindow(secondsRemaining),
      },
    ];
  });
}

export function toPassViews(
  passes: readonly { pointId: string; passedAt: Date; precision: PassView['precision'] }[],
  codes: PointCodes,
): PassView[] {
  return passes.flatMap((pass) => {
    const pointCode = codes.get(pass.pointId);
    return pointCode === undefined
      ? []
      : [
          {
            pointId: pass.pointId,
            pointCode,
            passedAt: pass.passedAt.toISOString(),
            precision: pass.precision,
          },
        ];
  });
}

export interface LiveTripInput {
  readonly live: LiveTrip;
  readonly route: Pick<RouteSnapshot, 'points' | 'geometry'>;
  /** The ETAs of the trip, estimated at `now`. */
  readonly etas: readonly PointEta[];
  readonly now: Date;
  readonly maxFixAgeSec: number;
}

export function toLiveTripView(input: LiveTripInput): LiveTripView {
  const { live, route, now } = input;
  const { trip } = live;
  const codes = pointCodesOf(route);
  const length = route.geometry.lengthMeters;
  return {
    tripId: trip.state.tripId,
    startedAt: trip.startedAt.toISOString(),
    startMode: trip.startMode,
    vehicle: { code: live.vehicle.code, label: live.vehicle.label },
    signal: telemetrySignal(trip.state.lastFixAt, now, input.maxFixAgeSec),
    lastFixAt: trip.state.lastFixAt?.toISOString() ?? null,
    lastPosition:
      live.lastPosition === null
        ? null
        : {
            lat: live.lastPosition.lat,
            lon: live.lastPosition.lon,
            fixTime: live.lastPosition.fixTime.toISOString(),
          },
    progress: {
      chainageMeters: round1(trip.state.progressChainage),
      percent: length > 0 ? round1(Math.min(100, (trip.state.progressChainage / length) * 100)) : 0,
      offRoute: trip.state.offRoute,
    },
    etas: toEtaViews(input.etas, codes),
    passes: toPassViews(live.passes, codes),
    alerts: live.alerts.flatMap((alert) => {
      const pointCode = codes.get(alert.pointId);
      return pointCode === undefined
        ? []
        : [
            {
              pointId: alert.pointId,
              pointCode,
              emittedAt: alert.emittedAt.toISOString(),
              communicatedPredictedPassAt: alert.communicatedPredictedPassAt.toISOString(),
              recipients: alert.recipients,
              delivered: alert.delivered,
            },
          ];
    }),
  };
}
