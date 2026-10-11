import type { RouteDetail } from '../../citizen/api/types';
import type { AlertStatus, OpenIncident, PanelLiveSnapshot } from '../api/types';

/** One row of the live pass table. */
export interface LiveRow {
  readonly pointCode: string;
  readonly name: string;
  /** The recorded pass (ISO), if any. */
  readonly passedAt: string | null;
  /** The live estimate (ISO) of a point not passed yet, if the signal allows one. */
  readonly predictedAt: string | null;
  /** Null without an active trip. */
  readonly alertStatus: AlertStatus | null;
  readonly deliveries: {
    readonly received: number;
    readonly sent: number;
    readonly failed: number;
  } | null;
  readonly incidents: readonly OpenIncident[];
}

export type LiveTripView = PanelLiveSnapshot['trips'][number];

/** The trip the table shows: the newest active one (the pilot runs one truck at a time). */
export function shownTrip(snapshot: PanelLiveSnapshot | undefined): LiveTripView | null {
  return snapshot?.trips[snapshot.trips.length - 1] ?? null;
}

/**
 * The pass table: every point of the trip with its pass, its alert state and the alert's
 * deliveries (confirmed receipts over recipients); without a trip, the route's points with
 * nothing recorded. Open incidents are listed at their point.
 */
export function liveRows(
  snapshot: PanelLiveSnapshot | undefined,
  route: Pick<RouteDetail, 'points'> | undefined,
): LiveRow[] {
  const incidents = snapshot?.openIncidents ?? [];
  const atPoint = (code: string) => incidents.filter((incident) => incident.pointCode === code);
  const trip = shownTrip(snapshot);
  if (trip === null) {
    return (route?.points ?? []).map((point) => ({
      pointCode: point.code,
      name: point.name,
      passedAt: null,
      predictedAt: null,
      alertStatus: null,
      deliveries: null,
      incidents: atPoint(point.code),
    }));
  }
  return [...trip.points]
    .sort((a, b) => a.sequence - b.sequence)
    .map((point) => ({
      pointCode: point.pointCode,
      name: point.name,
      passedAt: point.passedAt,
      predictedAt:
        point.passedAt === null && point.eta?.status === 'live' ? point.eta.predictedPassAt : null,
      alertStatus: point.alertStatus,
      deliveries:
        point.alert === null
          ? null
          : {
              received: point.alert.receiptsReceived,
              sent: point.alert.recipients,
              failed: point.alert.failed,
            },
      incidents: atPoint(point.pointCode),
    }));
}
