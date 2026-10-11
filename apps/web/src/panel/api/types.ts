/**
 * Panel API shapes (see the repository README, "Municipal panel API"). Copied on purpose, so the
 * web app never imports API code. Instants are ISO 8601 strings; calendar dates are `YYYY-MM-DD`
 * and times of day `HH:MM`, both local to the pilot (America/Lima).
 */
import type { LiveSnapshot, LiveTrip, PointEta } from '../../citizen/api/types';

export type Role = 'admin' | 'supervisor' | 'observer';

export type Permission =
  | 'live:read'
  | 'vehicles:read'
  | 'trips:read'
  | 'trips:write'
  | 'incidents:read'
  | 'incidents:create'
  | 'incidents:update'
  | 'households:read'
  | 'households:write'
  | 'households:delete'
  | 'field:read_own'
  | 'field:write_own'
  | 'field:read_all'
  | 'field:write_all'
  | 'indicators:read'
  | 'surveys:read'
  | 'surveys:write'
  | 'exports:read'
  | 'users:manage';

export interface PanelUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly active: boolean;
  readonly permissions: readonly Permission[];
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

/** A page of a list: `?page=1&pageSize=20` (at most 100). */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface PageQuery {
  readonly page?: number;
  readonly pageSize?: number;
}

// Fleet and trips

export interface Vehicle {
  readonly code: string;
  readonly label: string;
  readonly active: boolean;
  readonly defaultRoute: { readonly code: string; readonly name: string } | null;
  readonly signal: 'live' | 'stale' | 'none';
  readonly lastFix: {
    readonly at: string;
    readonly lat: number;
    readonly lon: number;
    readonly speedKmh: number | null;
  } | null;
  readonly activeTrip: {
    readonly id: string;
    readonly routeCode: string;
    readonly startedAt: string;
  } | null;
}

export type TripStatus = 'active' | 'completed' | 'aborted';

export interface Trip {
  readonly id: string;
  readonly routeCode: string;
  readonly routeName: string;
  readonly vehicleCode: string;
  readonly vehicleLabel: string;
  readonly status: TripStatus;
  readonly startMode: 'auto' | 'manual';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly endNote: string | null;
  readonly passedPoints: number;
  readonly totalPoints: number;
  readonly alertsCount: number;
}

export interface TripQuery extends PageQuery {
  readonly route?: string;
  readonly from?: string;
  readonly to?: string;
  readonly status?: TripStatus;
}

export interface TripPointAlert {
  readonly emittedAt: string;
  readonly communicatedPredictedPassAt: string | null;
  readonly secondsRemainingAtEmission: number | null;
  readonly insideTargetWindow: boolean | null;
  readonly recipients: number;
  readonly delivered: number;
  readonly receiptsReceived: number;
  readonly failed: number;
}

export interface TripDetail {
  readonly trip: Trip;
  readonly summary: {
    readonly durationSec: number;
    readonly fixCount: number;
    readonly offRouteCount: number;
    readonly maxGpsGapSec: number | null;
  };
  readonly points: readonly {
    readonly pointId: string;
    readonly pointCode: string;
    readonly pointName: string;
    readonly sequence: number;
    readonly passedAt: string | null;
    readonly precision: string | null;
    readonly alert: TripPointAlert | null;
  }[];
  readonly incidents: readonly {
    readonly id: string;
    readonly kind: IncidentKind;
    readonly pointCode: string | null;
    readonly description: string | null;
    readonly occurredAt: string;
    readonly resolvedAt: string | null;
  }[];
  /** GeoJSON `LineString` of the valid fixes (`[lon, lat]`). */
  readonly track: {
    readonly type: 'LineString';
    readonly coordinates: readonly (readonly [number, number])[];
  } | null;
}

// Live route

export type AlertStatus = 'sent' | 'preparing' | 'waiting' | 'not_sent';

export interface PanelPoint {
  readonly pointId: string;
  readonly pointCode: string;
  readonly name: string;
  readonly sequence: number;
  readonly alertStatus: AlertStatus;
  readonly eta: PointEta | null;
  readonly passedAt: string | null;
  readonly alert: {
    readonly emittedAt: string;
    readonly communicatedPredictedPassAt: string | null;
    readonly recipients: number;
    readonly delivered: number;
    readonly receiptsReceived: number;
    readonly failed: number;
  } | null;
}

export interface OpenIncident {
  readonly id: string;
  readonly kind: IncidentKind;
  readonly tripId: string | null;
  readonly pointCode: string | null;
  readonly description: string | null;
  readonly occurredAt: string;
}

export interface PanelLiveSnapshot extends Omit<LiveSnapshot, 'trips'> {
  readonly trips: readonly (LiveTrip & { readonly points: readonly PanelPoint[] })[];
  readonly openIncidents: readonly OpenIncident[];
}

// Incidents

export const INCIDENT_KINDS = [
  'truck_breakdown',
  'route_change',
  'gps_failure',
  'alert_failure',
  'missed_collection',
  'weather',
  'other',
] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface Incident {
  readonly id: string;
  readonly kind: IncidentKind;
  readonly routeCode: string;
  readonly tripId: string | null;
  readonly pointCode: string | null;
  readonly description: string | null;
  readonly occurredAt: string;
  readonly reportedBy: string | null;
  readonly reportedByUserId: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedByUserId: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncidentQuery extends PageQuery {
  readonly route?: string;
  readonly tripId?: string;
  readonly kind?: IncidentKind;
  readonly status?: 'open' | 'resolved';
  readonly from?: string;
  readonly to?: string;
}

export interface NewIncident {
  readonly kind: IncidentKind;
  readonly routeCode: string;
  readonly pointCode?: string;
  readonly tripId?: string;
  /** ISO with offset; defaults to now. */
  readonly occurredAt?: string;
  readonly description?: string;
}

export interface IncidentChanges {
  readonly kind?: IncidentKind;
  readonly description?: string;
  readonly resolved?: boolean;
  readonly resolutionNote?: string;
}

// Households

export interface Household {
  readonly id: string;
  readonly code: string;
  readonly routeId: string;
  readonly routeCode: string;
  readonly pointCode: string;
  readonly enrolledAt: string;
  readonly consentAt: string;
  readonly consentVersion: string;
  readonly active: boolean;
  readonly notes: string | null;
  readonly updatedAt: string;
}

export interface HouseholdListItem extends Household {
  readonly activeSubscriptions: number;
  readonly lastAlertReceivedAt: string | null;
  readonly lastAppViewAt: string | null;
}

export interface HouseholdQuery extends PageQuery {
  readonly route?: string;
  readonly point?: string;
  readonly active?: boolean;
}

export interface NewHousehold {
  readonly routeCode: string;
  readonly pointCode: string;
  readonly consentAt?: string;
  readonly consentVersion?: string;
  readonly notes?: string;
}

export interface HouseholdChanges {
  readonly pointCode?: string;
  readonly active?: boolean;
  readonly notes?: string | null;
}

export interface Sticker {
  readonly code: string;
  readonly url: string;
}

// Field observations (Instrument 2)

export const OBSERVATION_PHASES = ['baseline', 'intervention', 'post'] as const;
export type ObservationPhase = (typeof OBSERVATION_PHASES)[number];

export const DISPERSION_LEVELS = ['none', 'few', 'many'] as const;
export type Dispersion = (typeof DISPERSION_LEVELS)[number];

export const DISPERSION_CAUSES = [
  'animals',
  'wind',
  'manipulation',
  'undetermined',
  'other',
] as const;
export type DispersionCause = (typeof DISPERSION_CAUSES)[number];

export type ObservationProblem =
  | 'pass_before_placement'
  | 'broken_bags_exceed_bags'
  | 'causes_without_dispersion'
  | 'other_cause_text_required'
  | 'other_cause_text_without_other'
  | 'photo_code_without_photo'
  | 'music_not_observed_at_point'
  | 'music_window_invalid'
  | 'music_seconds_exceed_window';

export interface Photo {
  readonly taken: boolean;
  readonly code: string | null;
}

/** The sheet as it is sent (`POST`, and the whole sheet on `PUT`). */
export interface ObservationSheet {
  readonly routeCode: string;
  readonly pointCode: string;
  readonly tripId: string | null;
  readonly observedOn: string;
  readonly phase: ObservationPhase;
  readonly observers: string;
  readonly notes: string | null;
  readonly firstPlacementTime: string | null;
  readonly truckPassTime: string | null;
  readonly exposureMinutes: number | null;
  readonly bagsAtPass: number | null;
  readonly brokenBags: number | null;
  readonly dispersion: Dispersion | null;
  readonly dispersionCauses: readonly DispersionCause[];
  readonly dispersionCauseOther: string | null;
  readonly wasteRemainingAfterPass: boolean | null;
  readonly photoBefore: Photo;
  readonly photoAfter: Photo;
  readonly music: {
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly musicSeconds: number;
    readonly conditions: string | null;
  } | null;
  /** The placement happened before the observation began: the exposure is a minimum. */
  readonly exposureIncomplete: boolean;
  /** "Mismo punto y ventana"; null when not answered. */
  readonly comparableWindow: boolean | null;
}

export interface Observation extends ObservationSheet {
  readonly id: string;
  readonly routeId: string;
  readonly exposureComputed: boolean;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ObservationQuery extends PageQuery {
  readonly route?: string;
  readonly point?: string;
  readonly phase?: ObservationPhase;
  readonly from?: string;
  readonly to?: string;
}

// Baseline route logs (manual Instrument 1)

export interface BaselineLogInput {
  readonly routeCode: string;
  readonly serviceDate: string;
  readonly vehicleLabel?: string | null;
  readonly plannedStart?: string | null;
  readonly actualStart?: string | null;
  readonly notes?: string | null;
  readonly passes: readonly { readonly pointCode: string; readonly passedAt: string }[];
}

export interface BaselineLog {
  readonly id: string;
  readonly routeCode: string;
  readonly serviceDate: string;
  readonly vehicleLabel: string | null;
  readonly plannedStart: string | null;
  readonly actualStart: string | null;
  readonly notes: string | null;
  readonly passes: readonly {
    readonly pointCode: string;
    readonly sequence: number;
    readonly passedAt: string;
  }[];
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BaselineQuery extends PageQuery {
  readonly route?: string;
  readonly from?: string;
  readonly to?: string;
}

// Users

export interface NewUser {
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly password: string;
}

export interface UserChanges {
  readonly displayName?: string;
  readonly role?: Role;
  readonly active?: boolean;
  readonly password?: string;
}

// Impact indicators (Tabla 16): `GET /api/panel/indicators?route=&from=&to=`

export type IndicatorId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9';
export type IndicatorUnit = 'minutes' | 'ratio' | 'percent' | 'seconds' | 'score';
export type IndicatorStatus = 'met' | 'not_met' | 'no_data' | 'exploratory';

export type IndicatorTarget =
  | { readonly kind: 'at_most' | 'at_least'; readonly value: number }
  | { readonly kind: 'reduction'; readonly percent: number }
  | { readonly kind: 'increase_points'; readonly points: number }
  | { readonly kind: 'none' };

export interface IndicatorMeasure {
  readonly value: number | null;
  readonly nValid: number;
  readonly nMissing: number;
  readonly nIncomplete: number;
}

export type IndicatorChange =
  | { readonly kind: 'relative'; readonly percent: number | null }
  | { readonly kind: 'absolute' | 'points'; readonly difference: number | null };

export interface PairedTest {
  readonly kind: 'wilcoxon' | 'mcnemar';
  readonly pairs: number;
  readonly pValue: number | null;
}

export interface Indicator extends IndicatorMeasure {
  readonly id: IndicatorId;
  readonly name: string;
  readonly unit: IndicatorUnit;
  readonly target: IndicatorTarget;
  readonly status: IndicatorStatus;
  readonly phases: { readonly before: 'baseline' | 'pre'; readonly after: 'post' } | null;
  readonly before: IndicatorMeasure | null;
  readonly after: IndicatorMeasure | null;
  readonly change: IndicatorChange | null;
  readonly paired: PairedTest | null;
  readonly details: Readonly<Record<string, number | null>>;
}

export interface AdoptionWeek {
  readonly weekStart: string;
  readonly enrolled: number;
  readonly active: number;
  readonly activeConfirmed: number;
}

export interface IndicatorReport {
  readonly routeCode: string;
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly indicators: readonly Indicator[];
  readonly adoptionWeeks: readonly AdoptionWeek[];
}

export interface IndicatorQuery {
  readonly route: string;
  readonly from: string;
  readonly to: string;
}

// Instrument 3, household surveys: `/api/panel/household-surveys`

export const SURVEY_WAVES = ['pre', 'post'] as const;
export type SurveyWave = (typeof SURVEY_WAVES)[number];
export const LEAD_TIMES = ['0_15', '15_60', '1_3h', 'gt_3h', 'after_pass'] as const;
export type LeadTime = (typeof LEAD_TIMES)[number];
export const MISSED_PICKUPS = ['0', '1_2', '3_plus'] as const;
export type MissedPickups = (typeof MISSED_PICKUPS)[number];
export const LITTER_SEEN = ['never', 'sometimes', 'often'] as const;
export type LitterSeen = (typeof LITTER_SEEN)[number];
export const SEPARATES = ['yes', 'sometimes', 'no'] as const;
export type Separates = (typeof SEPARATES)[number];
export const INTERRUPTIONS = ['never', '1_2', '3_plus', 'not_heard'] as const;
export type Interruptions = (typeof INTERRUPTIONS)[number];
export const CHANNELS = [
  'music',
  'alert',
  'web_map',
  'printed_schedule',
  'neighbor',
  'other',
] as const;
export type Channel = (typeof CHANNELS)[number];
export const ACCESS = ['yes', 'with_help', 'no'] as const;
export type Access = (typeof ACCESS)[number];

/** Questions 6–11 (post wave only), on 1–5 scales. */
export const POST_ONLY_QUESTIONS = [
  'alertsHelped',
  'easyToUse',
  'etaReliable',
  'streetCleaner',
  'keepSystem',
  'satisfaction',
] as const;
export type PostOnlyQuestion = (typeof POST_ONLY_QUESTIONS)[number];

export interface SurveyInput {
  readonly householdCode: string;
  readonly wave: SurveyWave;
  readonly surveyedOn: string;
  readonly knowsSchedule: boolean | null;
  readonly leadTime: LeadTime | null;
  readonly missedPickups: MissedPickups | null;
  readonly litterSeen: LitterSeen | null;
  readonly separates: Separates | null;
  readonly alertsHelped: number | null;
  readonly easyToUse: number | null;
  readonly etaReliable: number | null;
  readonly streetCleaner: number | null;
  readonly keepSystem: number | null;
  readonly satisfaction: number | null;
  readonly annoyance: number | null;
  readonly notHeard: boolean;
  readonly interrupted: Interruptions | null;
  readonly channels: readonly Channel[];
  readonly channelOther: string | null;
  readonly access: Access | null;
  readonly altChannel: string | null;
}

export interface Survey extends SurveyInput {
  readonly id: string;
  readonly routeCode: string;
  readonly importBatchId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SurveyProblem =
  | 'post_only_answer_in_pre'
  | 'annoyance_and_not_heard'
  | 'other_channel_text_required'
  | 'other_channel_text_without_other'
  | 'alt_channel_without_no_access';

export interface SurveyQuery extends PageQuery {
  readonly route?: string;
  readonly wave?: SurveyWave;
  readonly household?: string;
}

/** One problem of one row of an imported CSV file (`column` null: the whole row). */
export interface ImportRowError {
  readonly line: number;
  readonly column: string | null;
  readonly problem: string;
}

export interface SurveyImport {
  readonly batchId: string;
  readonly created: number;
  readonly updated: number;
}
