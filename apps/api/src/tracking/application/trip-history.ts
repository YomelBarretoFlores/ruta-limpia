import type { TrackFix } from '../domain/track-summary.js';
import type { TripStartMode } from './ports.js';

export type TripStatus = 'active' | 'completed' | 'aborted';

export interface TripFilter {
  readonly routeCode?: string;
  /** First service date (America/Lima, `YYYY-MM-DD`), inclusive. */
  readonly from?: string;
  /** Last service date (America/Lima, `YYYY-MM-DD`), inclusive. */
  readonly to?: string;
  readonly status?: TripStatus;
}

export interface TripSummaryRow {
  readonly id: string;
  readonly routeCode: string;
  readonly routeName: string;
  readonly vehicleCode: string;
  readonly vehicleLabel: string;
  readonly status: TripStatus;
  readonly startMode: TripStartMode;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly endReason: string | null;
  /** The operator's reason for a manual end. */
  readonly endNote: string | null;
  readonly passedPoints: number;
  readonly totalPoints: number;
  readonly alertsCount: number;
}

/** Push delivery of one alert: recipients, accepted by the push service, confirmed, failed. */
export interface DeliveryStats {
  readonly recipients: number;
  readonly delivered: number;
  readonly receiptsReceived: number;
  readonly failed: number;
}

export interface TripAlertRow extends DeliveryStats {
  readonly emittedAt: Date;
  readonly communicatedPredictedPassAt: Date;
  readonly secondsRemainingAtEmission: number;
  readonly insideTargetWindow: boolean;
}

/** One reference point of the trip's route: its pass and its alert, if any. */
export interface TripPointRow {
  readonly pointId: string;
  readonly pointCode: string;
  readonly pointName: string;
  readonly sequence: number;
  readonly passedAt: Date | null;
  readonly precision: 'interpolated' | 'upper_bound' | null;
  readonly alert: TripAlertRow | null;
}

export interface TripIncidentRow {
  readonly id: string;
  readonly kind: string;
  readonly pointCode: string | null;
  readonly description: string;
  readonly occurredAt: Date;
  readonly resolvedAt: Date | null;
}

export interface TrackPosition extends TrackFix {
  readonly lat: number;
  readonly lon: number;
  readonly valid: boolean;
}

export interface TripDetailRows {
  readonly trip: TripSummaryRow;
  readonly points: readonly TripPointRow[];
  readonly incidents: readonly TripIncidentRow[];
  readonly positions: readonly TrackPosition[];
}

export interface VehicleRow {
  readonly code: string;
  readonly label: string;
  readonly active: boolean;
  readonly defaultRoute: { readonly code: string; readonly name: string } | null;
  readonly lastFix: {
    readonly at: Date;
    readonly lat: number;
    readonly lon: number;
    readonly speedKmh: number;
  } | null;
  readonly activeTrip: {
    readonly id: string;
    readonly routeCode: string;
    readonly startedAt: Date;
  } | null;
}

/** Port: read-only queries of the panel's trip history and fleet. */
export interface TripHistoryQueries {
  list(
    filter: TripFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: TripSummaryRow[]; readonly total: number }>;
  summary(tripId: string): Promise<TripSummaryRow | null>;
  detail(tripId: string): Promise<TripDetailRows | null>;
  vehicles(): Promise<VehicleRow[]>;
  findVehicleIdByCode(code: string): Promise<string | null>;
  findRouteIdByCode(code: string): Promise<string | null>;
}
