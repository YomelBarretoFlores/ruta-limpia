import type { RouteSnapshot } from '../../routes/application/route-catalog.js';
import type { AlertView, EtaView, LiveTripView, PassView } from './live-views.js';

/**
 * The alert state of a point in the panel's pass table:
 * - `sent` ("Enviado"): the proximity alert was emitted;
 * - `preparing` ("En preparación"): the truck is coming with fresh telemetry, not yet alerted;
 * - `waiting` ("En espera"): no live prediction (telemetry stale, or the trip has not reached
 *   a basis for it);
 * - `not_sent` ("No enviado"): the truck passed without an alert.
 */
export type PanelAlertStatus = 'sent' | 'preparing' | 'waiting' | 'not_sent';

export function panelAlertStatus(input: {
  readonly alert: AlertView | undefined;
  readonly pass: PassView | undefined;
  readonly eta: EtaView | undefined;
}): PanelAlertStatus {
  if (input.alert !== undefined) return 'sent';
  if (input.pass !== undefined || input.eta?.status === 'passed') return 'not_sent';
  if (input.eta?.status === 'live') return 'preparing';
  return 'waiting';
}

/** Push delivery of one point's alert. */
export interface PointDeliveryStats {
  readonly tripId: string;
  readonly pointId: string;
  readonly recipients: number;
  readonly delivered: number;
  readonly receiptsReceived: number;
  readonly failed: number;
}

export interface PanelPointView {
  readonly pointId: string;
  readonly pointCode: string;
  readonly name: string;
  readonly sequence: number;
  readonly alertStatus: PanelAlertStatus;
  readonly eta: EtaView | null;
  readonly passedAt: string | null;
  readonly alert:
    | (Omit<AlertView, 'pointId' | 'pointCode'> & {
        readonly receiptsReceived: number;
        readonly failed: number;
      })
    | null;
}

/** The pass table of one live trip: every active point of the route in sequence. */
export function toPanelPoints(
  trip: LiveTripView,
  route: Pick<RouteSnapshot, 'points'>,
  stats: readonly PointDeliveryStats[],
): PanelPointView[] {
  const byPoint = <T extends { pointId: string }>(items: readonly T[]) =>
    new Map(items.map((item) => [item.pointId, item]));
  const etas = byPoint(trip.etas);
  const passes = byPoint(trip.passes);
  const alerts = byPoint(trip.alerts);
  const deliveries = byPoint(stats.filter((s) => s.tripId === trip.tripId));
  return [...route.points]
    .sort((a, b) => a.sequence - b.sequence)
    .map((point) => {
      const alert = alerts.get(point.id);
      const pass = passes.get(point.id);
      const eta = etas.get(point.id);
      const delivery = deliveries.get(point.id);
      return {
        pointId: point.id,
        pointCode: point.code,
        name: point.name,
        sequence: point.sequence,
        alertStatus: panelAlertStatus({ alert, pass, eta }),
        eta: eta ?? null,
        passedAt: pass?.passedAt ?? null,
        alert:
          alert === undefined
            ? null
            : {
                emittedAt: alert.emittedAt,
                communicatedPredictedPassAt: alert.communicatedPredictedPassAt,
                recipients: delivery?.recipients ?? alert.recipients,
                delivered: delivery?.delivered ?? alert.delivered,
                receiptsReceived: delivery?.receiptsReceived ?? 0,
                failed: delivery?.failed ?? 0,
              },
      };
    });
}
