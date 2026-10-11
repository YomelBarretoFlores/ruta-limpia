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
  reported_by: string;
  created_at: CreatedAt;
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
  instrument1_route_log: Instrument1RouteLogView;
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
