/**
 * Public API shapes used by the citizen app. They mirror the API's response schemas (see the
 * repository README, "Public read API" and "Web Push subscriptions"); they are copied on purpose,
 * so the web app never imports API code.
 */

/** `GET /api/routes` entry. */
export interface RouteSummary {
  readonly code: string;
  readonly name: string;
  readonly district: string;
  readonly lengthMeters: number;
  readonly pointCount: number;
}

export interface ReferencePoint {
  readonly code: string;
  readonly name: string;
  readonly sequence: number;
  readonly lat: number;
  readonly lon: number;
  readonly chainageMeters: number;
  readonly observesMusic: boolean;
}

/** A planned start of the weekly schedule: 0 = Sunday … 6 = Saturday, local time `HH:MM`. */
export interface ScheduleEntry {
  readonly weekday: number;
  readonly plannedStart: string;
}

/** `GET /api/routes/:code`. */
export interface RouteDetail extends RouteSummary {
  readonly timeZone: string;
  /** `[lon, lat]` pairs. */
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly (readonly [number, number])[];
  };
  readonly points: readonly ReferencePoint[];
  readonly schedule: readonly ScheduleEntry[];
}

/** `live`: fresh telemetry; `stale`: no fix for `staleAfterSeconds`; `none`: no fix yet. */
export type TelemetrySignal = 'live' | 'stale' | 'none';

/** The ETA of one point. Only `live` entries carry a prediction. */
export type PointEta =
  | {
      readonly pointId: string;
      readonly pointCode: string;
      readonly status: 'live';
      readonly predictedPassAt: string;
      readonly secondsRemaining: number;
      readonly window: { readonly minMinutes: number; readonly maxMinutes: number };
    }
  | {
      readonly pointId: string;
      readonly pointCode: string;
      readonly status: 'stale' | 'passed' | 'not_started';
    };

export interface PointPass {
  readonly pointId: string;
  readonly pointCode: string;
  readonly passedAt: string;
  readonly precision: 'interpolated' | 'upper_bound';
}

export interface LiveTrip {
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
    /** Heading in degrees from north; only `vehicle.position` events carry it. */
    readonly course?: number | null;
  } | null;
  readonly progress: {
    readonly chainageMeters: number;
    readonly percent: number;
    readonly offRoute: boolean;
  };
  readonly etas: readonly PointEta[];
  readonly passes: readonly PointPass[];
  readonly alerts: readonly unknown[];
}

/** `GET /api/live/routes/:code`, also the `snapshot` event of the stream. */
export interface LiveSnapshot {
  readonly route: { readonly code: string; readonly name: string };
  readonly generatedAt: string;
  readonly staleAfterSeconds: number;
  readonly trips: readonly LiveTrip[];
}

/** Data of the stream events (`GET /api/live/routes/:code/stream`). */
export interface LiveStreamEvents {
  readonly snapshot: LiveSnapshot;
  readonly 'vehicle.position': {
    readonly tripId: string;
    readonly vehicleCode: string;
    readonly fixTime: string;
    readonly lat: number;
    readonly lon: number;
    readonly speedKmh: number;
    readonly course: number | null;
  };
  readonly 'eta.updated': {
    readonly tripId: string;
    readonly computedAt: string;
    readonly lastFixAt: string | null;
    readonly signal: TelemetrySignal;
    readonly etas: readonly PointEta[];
  };
  readonly 'point.passed': PointPass & { readonly tripId: string };
  readonly 'trip.started': {
    readonly tripId: string;
    readonly startedAt: string;
    readonly startMode: 'auto' | 'manual';
  };
  readonly 'trip.completed': {
    readonly tripId: string;
    readonly status: 'completed' | 'aborted';
    readonly endedAt: string;
    readonly endReason: string | null;
  };
}

export type LiveStreamEventName = keyof LiveStreamEvents;

/** The browser's `PushSubscription.toJSON()`. */
export interface PushSubscriptionJson {
  readonly endpoint: string;
  readonly expirationTime?: number | null;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** `POST /api/subscriptions` body. */
export interface SubscribeRequest {
  readonly subscription: PushSubscriptionJson;
  readonly pointCode: string;
  readonly routeCode: string;
  readonly householdCode?: string;
  readonly consent: true;
  readonly consentVersion: string;
}

/** `POST /api/subscriptions` 201 answer. */
export interface SubscribeResponse {
  readonly subscriptionId: string;
  readonly managementToken: string;
  readonly point: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly routeCode: string;
  };
}

/** `POST /api/usage/views` body. */
export interface ViewRequest {
  readonly pointCode: string;
  readonly routeCode?: string;
  readonly subscriptionId?: string;
  readonly managementToken?: string;
}
