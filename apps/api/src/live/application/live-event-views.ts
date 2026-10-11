import { telemetrySignal } from '../../eta/domain/staleness.js';
import type { RouteSnapshot } from '../../routes/application/route-catalog.js';
import type {
  TrackingEventName,
  TrackingEvents,
} from '../../tracking/application/tracking-events.js';
import { pointCodesOf, toEtaViews, type PointCodes } from './live-views.js';

/** The tracking events the public live stream forwards (`trip.updated` stays internal). */
export const STREAMED_EVENTS = [
  'vehicle.position',
  'eta.updated',
  'point.passed',
  'trip.started',
  'trip.completed',
  'alert.emitted',
] as const satisfies readonly TrackingEventName[];

export type StreamedEventName = (typeof STREAMED_EVENTS)[number];

/** One event of the public stream: its name and its JSON-ready, public-safe data. */
export interface LiveStreamEvent {
  readonly event: 'snapshot' | StreamedEventName;
  readonly data: object;
}

/** The route a stream follows, with what the mapping needs. */
export interface StreamedRoute {
  readonly id: string;
  readonly codes: PointCodes;
  /** Telemetry older than this is stale. */
  readonly maxFixAgeSec: number;
}

export function streamedRoute(
  route: Pick<RouteSnapshot, 'id' | 'points'>,
  maxFixAgeSec: number,
): StreamedRoute {
  return { id: route.id, codes: pointCodesOf(route), maxFixAgeSec };
}

type Mapper<K extends StreamedEventName> = (
  payload: TrackingEvents[K],
  route: StreamedRoute,
) => object | null;

/**
 * Builds the public data of each streamed event, or null when the event does not concern the
 * route (or must not be shown, such as an invalid fix). Only public fields are copied: no vehicle,
 * alert or subscription ids, no tokens.
 */
const MAPPERS: { readonly [K in StreamedEventName]: Mapper<K> } = {
  'vehicle.position': (p, route) =>
    p.routeId !== route.id || p.tripId === null || !p.valid
      ? null
      : {
          tripId: p.tripId,
          vehicleCode: p.vehicleCode,
          fixTime: p.fixTime.toISOString(),
          lat: p.lat,
          lon: p.lon,
          speedKmh: p.speedKmh,
          course: p.course,
        },
  'eta.updated': (p, route) =>
    p.routeId !== route.id
      ? null
      : {
          tripId: p.tripId,
          computedAt: p.computedAt.toISOString(),
          lastFixAt: p.lastFixAt?.toISOString() ?? null,
          signal: telemetrySignal(p.lastFixAt, p.computedAt, route.maxFixAgeSec),
          etas: toEtaViews(p.etas, route.codes),
        },
  'point.passed': (p, route) => {
    const pointCode = route.codes.get(p.pointId);
    return p.routeId !== route.id || pointCode === undefined
      ? null
      : {
          tripId: p.tripId,
          pointId: p.pointId,
          pointCode,
          passedAt: p.passedAt.toISOString(),
          precision: p.precision,
        };
  },
  'trip.started': (p, route) =>
    p.routeId !== route.id
      ? null
      : { tripId: p.tripId, startedAt: p.startedAt.toISOString(), startMode: p.startMode },
  'trip.completed': (p, route) =>
    p.routeId !== route.id
      ? null
      : {
          tripId: p.tripId,
          status: p.status,
          endedAt: p.endedAt.toISOString(),
          endReason: p.endReason,
        },
  'alert.emitted': (p, route) => {
    const pointCode = route.codes.get(p.pointId);
    return p.routeId !== route.id || pointCode === undefined
      ? null
      : {
          tripId: p.tripId,
          pointId: p.pointId,
          pointCode,
          emittedAt: p.emittedAt.toISOString(),
          communicatedPredictedPassAt: p.communicatedPredictedPassAt.toISOString(),
        };
  },
};

/** The public stream event for a tracking event, or null when it is not for this route. */
export function toLiveStreamEvent<K extends StreamedEventName>(
  name: K,
  payload: TrackingEvents[K],
  route: StreamedRoute,
): LiveStreamEvent | null {
  const data = (MAPPERS[name] as Mapper<K>)(payload, route);
  return data === null ? null : { event: name, data };
}
