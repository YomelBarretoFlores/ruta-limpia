import { sql, type Kysely } from 'kysely';

/**
 * Initial schema: route catalog, vehicles, raw positions, trips with their passes and alerts,
 * incidents, and the Instrument 1 route log view.
 *
 * Integrity rules live in the database, which is the final guard under concurrency:
 * - at most one active trip per vehicle (partial unique index);
 * - one alert per (trip, point) and one pass per (trip, point);
 * - Traccar position ids are unique, which makes ingestion idempotent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(db);

  await sql`
    CREATE TABLE routes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      district text NOT NULL,
      geometry geography(LineString, 4326) NOT NULL,
      length_m double precision NOT NULL CHECK (length_m > 0),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE route_schedules (
      route_id uuid NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      planned_start time NOT NULL,
      PRIMARY KEY (route_id, weekday)
    )`.execute(db);

  await sql`
    CREATE TABLE reference_points (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id uuid NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      sequence integer NOT NULL CHECK (sequence > 0),
      location geography(Point, 4326) NOT NULL,
      chainage_m double precision NOT NULL CHECK (chainage_m >= 0),
      offset_m double precision NOT NULL CHECK (offset_m >= 0),
      observes_music boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      UNIQUE (route_id, code),
      UNIQUE (route_id, sequence)
    )`.execute(db);

  await sql`
    CREATE TABLE vehicles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      label text NOT NULL,
      traccar_unique_id text NOT NULL UNIQUE,
      default_route_id uuid REFERENCES routes (id),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE trips (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id uuid NOT NULL REFERENCES routes (id),
      vehicle_id uuid NOT NULL REFERENCES vehicles (id),
      status text NOT NULL CHECK (status IN ('active', 'completed', 'aborted')),
      start_mode text NOT NULL CHECK (start_mode IN ('auto', 'manual')),
      started_at timestamptz NOT NULL,
      ended_at timestamptz,
      end_reason text,
      progress_chainage_m double precision NOT NULL DEFAULT 0,
      progress_at timestamptz,
      last_fix_at timestamptz,
      off_route boolean NOT NULL DEFAULT false,
      recent_speed jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((status = 'active') = (ended_at IS NULL))
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX trips_one_active_per_vehicle ON trips (vehicle_id) WHERE status = 'active'`.execute(
    db,
  );
  await sql`CREATE INDEX trips_route_status_ended_idx ON trips (route_id, status, ended_at DESC)`.execute(
    db,
  );

  await sql`
    CREATE TABLE positions (
      id bigserial PRIMARY KEY,
      vehicle_id uuid NOT NULL REFERENCES vehicles (id),
      trip_id uuid REFERENCES trips (id),
      traccar_position_id bigint NOT NULL UNIQUE,
      fix_time timestamptz NOT NULL,
      server_time timestamptz,
      received_at timestamptz NOT NULL DEFAULT now(),
      location geography(Point, 4326) NOT NULL,
      speed_kmh double precision NOT NULL,
      course double precision,
      valid boolean NOT NULL,
      accuracy double precision,
      chainage_m double precision,
      off_route boolean
    )`.execute(db);
  await sql`CREATE INDEX positions_vehicle_fix_time_idx ON positions (vehicle_id, fix_time DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX positions_trip_fix_time_idx ON positions (trip_id, fix_time)`.execute(db);

  await sql`
    CREATE TABLE trip_point_passes (
      trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
      point_id uuid NOT NULL REFERENCES reference_points (id),
      passed_at timestamptz NOT NULL,
      "precision" text NOT NULL CHECK ("precision" IN ('interpolated', 'upper_bound')),
      PRIMARY KEY (trip_id, point_id)
    )`.execute(db);

  await sql`
    CREATE TABLE alerts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
      point_id uuid NOT NULL REFERENCES reference_points (id),
      emitted_at timestamptz NOT NULL,
      communicated_predicted_pass_at timestamptz NOT NULL,
      seconds_remaining_at_emission double precision NOT NULL,
      inside_target_window boolean NOT NULL,
      recipients_count integer NOT NULL DEFAULT 0 CHECK (recipients_count >= 0),
      delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
      failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      UNIQUE (trip_id, point_id)
    )`.execute(db);

  await sql`
    CREATE TABLE incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid REFERENCES trips (id),
      route_id uuid NOT NULL REFERENCES routes (id),
      point_id uuid REFERENCES reference_points (id),
      kind text NOT NULL,
      description text NOT NULL DEFAULT '',
      occurred_at timestamptz NOT NULL,
      reported_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX incidents_trip_idx ON incidents (trip_id)`.execute(db);

  // Instrument 1 (route/telemetry log): one row per reference point of every trip. Alert columns and
  // the error stay null when no alert was sent: a prediction is never reconstructed afterwards.
  // Dates and weekdays use the pilot's local time zone (America/Lima, no DST).
  await sql`
    CREATE VIEW instrument1_route_log AS
    SELECT
      t.id AS trip_id,
      to_char(t.started_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS service_date,
      r.code AS route_code,
      v.code AS vehicle_code,
      t.status AS trip_status,
      to_char(s.planned_start, 'HH24:MI:SS') AS planned_start,
      t.started_at AS actual_start,
      t.ended_at AS actual_end,
      p.sequence AS point_sequence,
      p.code AS point_code,
      a.emitted_at AS alert_emitted_at,
      a.communicated_predicted_pass_at AS communicated_eta,
      pp.passed_at AS actual_passed_at,
      pp."precision" AS pass_precision,
      CASE
        WHEN a.id IS NOT NULL AND pp.passed_at IS NOT NULL THEN
          (abs(extract(epoch FROM pp.passed_at - a.communicated_predicted_pass_at)) / 60)::double precision
      END AS abs_error_minutes,
      (SELECT count(*) FROM incidents i WHERE i.trip_id = t.id AND i.point_id = p.id)::integer
        AS point_incidents_count,
      (SELECT count(*) FROM incidents i WHERE i.trip_id = t.id)::integer AS trip_incidents_count
    FROM trips t
    JOIN routes r ON r.id = t.route_id
    JOIN vehicles v ON v.id = t.vehicle_id
    JOIN reference_points p ON p.route_id = t.route_id AND p.active
    LEFT JOIN route_schedules s
      ON s.route_id = t.route_id
      AND s.weekday = extract(dow FROM t.started_at AT TIME ZONE 'America/Lima')::integer
    LEFT JOIN trip_point_passes pp ON pp.trip_id = t.id AND pp.point_id = p.id
    LEFT JOIN alerts a ON a.trip_id = t.id AND a.point_id = p.id`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS instrument1_route_log`.execute(db);
  for (const table of [
    'incidents',
    'alerts',
    'trip_point_passes',
    'positions',
    'trips',
    'vehicles',
    'reference_points',
    'route_schedules',
    'routes',
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
}
