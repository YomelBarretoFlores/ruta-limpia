import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

/**
 * PostGIS geography values are always written with SQL expressions (`ST_GeogFromText`, ...) and read
 * through functions (`ST_AsGeoJSON`, `ST_X`, ...), never as raw column values.
 */
type Geography = ColumnType<unknown, unknown, unknown>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface RoutesTable {
  id: Generated<string>;
  code: string;
  name: string;
  district: string;
  geometry: Geography;
  length_m: number;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface RouteSchedulesTable {
  route_id: string;
  /** 0 = Sunday … 6 = Saturday, as PostgreSQL `extract(dow …)`. */
  weekday: number;
  /** Local time of day (America/Lima), `HH:MM:SS`. */
  planned_start: string;
}

export interface ReferencePointsTable {
  id: Generated<string>;
  route_id: string;
  code: string;
  name: string;
  sequence: number;
  location: Geography;
  chainage_m: number;
  offset_m: number;
  observes_music: Generated<boolean>;
  active: Generated<boolean>;
}

export interface VehiclesTable {
  id: Generated<string>;
  code: string;
  label: string;
  traccar_unique_id: string;
  default_route_id: string | null;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface PositionsTable {
  /** bigserial: the pg driver returns int8 values as strings. */
  id: Generated<string>;
  vehicle_id: string;
  trip_id: string | null;
  traccar_position_id: ColumnType<string, number | string, never>;
  fix_time: Date;
  server_time: Date | null;
  received_at: Date;
  location: Geography;
  speed_kmh: number;
  course: number | null;
  valid: boolean;
  accuracy: number | null;
  /** Trip progress after this fix when the fix was accepted on route; null otherwise. */
  chainage_m: number | null;
  /** Trip off-route flag after this fix; null when the fix belongs to no trip. */
  off_route: boolean | null;
}

export type TripStatusColumn = 'active' | 'completed' | 'aborted';
export type TripStartModeColumn = 'auto' | 'manual';

/** Serialized `RecentSpeed` (eta domain): dates as ISO strings. */
export interface StoredRecentSpeed {
  readonly speedMps: number | null;
  readonly averageMps: number | null;
  readonly lastSample: { readonly chainage: number; readonly at: string } | null;
}

export interface TripsTable {
  id: Generated<string>;
  route_id: string;
  vehicle_id: string;
  status: TripStatusColumn;
  start_mode: TripStartModeColumn;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  /** The operator's note on a manual end (migration 0006-panel-operations). */
  end_note: Generated<string | null>;
  progress_chainage_m: Generated<number>;
  progress_at: Date | null;
  last_fix_at: Date | null;
  off_route: Generated<boolean>;
  recent_speed: ColumnType<StoredRecentSpeed | null, string | null, string | null>;
  created_at: CreatedAt;
}

export type PassPrecisionColumn = 'interpolated' | 'upper_bound';

export interface TripPointPassesTable {
  trip_id: string;
  point_id: string;
  passed_at: Date;
  precision: PassPrecisionColumn;
}

export interface AlertsTable {
  id: Generated<string>;
  trip_id: string;
  point_id: string;
  emitted_at: Date;
  communicated_predicted_pass_at: Date;
  seconds_remaining_at_emission: number;
  inside_target_window: boolean;
  recipients_count: Generated<number>;
  delivered_count: Generated<number>;
  failed_count: Generated<number>;
}

export interface IncidentsTable {
  id: Generated<string>;
  trip_id: string | null;
  route_id: string;
  point_id: string | null;
  kind: string;
  description: Generated<string>;
  occurred_at: Date;
  /** The reporter's display name at the time (kept if the user is deleted). */
  reported_by: string;
  created_at: CreatedAt;
  reported_by_user_id: string | null;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  updated_at: Generated<Date>;
}

export interface HouseholdsTable {
  id: Generated<string>;
  /** Public household code from the enrollment sticker, for example `H-001`. */
  code: string;
  route_id: string;
  point_id: string;
  enrolled_at: Date;
  consent_at: Date;
  consent_version: string;
  active: Generated<boolean>;
  notes: string | null;
  /** Migration 0007-household-registry. */
  created_by_user_id: string | null;
  updated_at: Generated<Date>;
}

export type RevokeReasonColumn = 'user_cancelled' | 'expired' | 'too_many_failures';

export interface PushSubscriptionsTable {
  id: Generated<string>;
  endpoint: string;
  p256dh: string;
  auth: string;
  point_id: string;
  household_id: string | null;
  consent_at: Date;
  consent_version: string;
  /** SHA-256 (hex) of the management token; the token itself is never stored. */
  management_token_hash: string;
  created_at: CreatedAt;
  revoked_at: Date | null;
  revoke_reason: RevokeReasonColumn | null;
  last_success_at: Date | null;
  consecutive_failures: Generated<number>;
}

export type DeliveryStatusColumn = 'sent' | 'failed' | 'expired';

export interface AlertDeliveriesTable {
  id: Generated<string>;
  alert_id: string;
  subscription_id: string;
  status: DeliveryStatusColumn;
  http_status: number | null;
  sent_at: Date;
  /** Set when the service worker confirms reception; null when it could not. */
  received_at: Date | null;
}

/** One app view ("consulta"); never an IP address or a user agent. */
export interface AppViewsTable {
  id: Generated<string>;
  point_id: string;
  /** Set only when the browser proved the subscription's management token. */
  subscription_id: string | null;
  /** The household of that subscription, when it has one. */
  household_id: string | null;
  viewed_at: Date;
}

/** One Instrument 1 row: a reference point of a trip (read-only view). */
export interface Instrument1RouteLogView {
  trip_id: string;
  /** Service date in America/Lima, `YYYY-MM-DD`. */
  service_date: string;
  route_code: string;
  vehicle_code: string;
  trip_status: TripStatusColumn;
  planned_start: string | null;
  actual_start: Date;
  actual_end: Date | null;
  point_sequence: number;
  point_code: string;
  alert_emitted_at: Date | null;
  communicated_eta: Date | null;
  actual_passed_at: Date | null;
  pass_precision: PassPrecisionColumn | null;
  /** |communicated ETA − actual pass| in minutes; null unless an alert was actually sent. */
  abs_error_minutes: number | null;
  point_incidents_count: number;
  trip_incidents_count: number;
}

export type RoleColumn = 'admin' | 'supervisor' | 'observer';

/** A panel user. Usernames are stored in lower case; the password is a PHC-encoded scrypt hash. */
export interface UsersTable {
  id: Generated<string>;
  username: string;
  display_name: string;
  role: RoleColumn;
  password_hash: string;
  active: Generated<boolean>;
  failed_attempts: Generated<number>;
  locked_until: Date | null;
  created_at: CreatedAt;
  last_login_at: Date | null;
}

/** A panel session; only the SHA-256 (hex) of its cookie token is stored. */
export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  user_agent_class: 'mobile' | 'desktop' | 'other' | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

/** Append-only audit trail of panel actions; `details` never holds secrets or personal data. */
export interface AuditEventsTable {
  /** bigint identity: the pg driver returns int8 values as strings. */
  id: Generated<string>;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  at: Date;
  details: ColumnType<Record<string, unknown>, string, never>;
}

/** Instrument 2: one point observation sheet (migration 0008-field-observations). */
export interface FieldObservationsTable {
  id: Generated<string>;
  route_id: string;
  point_id: string;
  trip_id: string | null;
  /** `YYYY-MM-DD`: always written and read as text (`to_char`), never as a JS Date. */
  observed_on: ColumnType<string, string, string>;
  phase: 'baseline' | 'intervention' | 'post';
  observers: string;
  /** Local times of day: written `HH:MM`, read back `HH:MM:SS`. */
  first_placement_time: string | null;
  truck_pass_time: string | null;
  exposure_minutes: number | null;
  exposure_computed: Generated<boolean>;
  bags_at_pass: number | null;
  broken_bags: number | null;
  dispersion: 'none' | 'few' | 'many' | null;
  dispersion_causes: ColumnType<string[], string[] | undefined, string[]>;
  dispersion_cause_other: string | null;
  waste_remaining_after_pass: boolean | null;
  photo_before_taken: Generated<boolean>;
  photo_before_code: string | null;
  photo_after_taken: Generated<boolean>;
  photo_after_code: string | null;
  music_window_start: string | null;
  music_window_end: string | null;
  music_seconds: number | null;
  music_conditions: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Database {
  routes: RoutesTable;
  route_schedules: RouteSchedulesTable;
  reference_points: ReferencePointsTable;
  vehicles: VehiclesTable;
  positions: PositionsTable;
  trips: TripsTable;
  trip_point_passes: TripPointPassesTable;
  alerts: AlertsTable;
  incidents: IncidentsTable;
  households: HouseholdsTable;
  push_subscriptions: PushSubscriptionsTable;
  alert_deliveries: AlertDeliveriesTable;
  app_views: AppViewsTable;
  instrument1_route_log: Instrument1RouteLogView;
  users: UsersTable;
  sessions: SessionsTable;
  audit_events: AuditEventsTable;
  field_observations: FieldObservationsTable;
}

export interface DatabaseOptions {
  readonly poolMax?: number;
}

/** Creates the Kysely instance and its pg pool. Call `destroy()` to close the pool. */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new pg.Pool({ connectionString, max: options.poolMax ?? 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export type AppDatabase = Kysely<Database>;
