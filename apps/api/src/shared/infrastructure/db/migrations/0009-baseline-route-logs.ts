import { sql, type Kysely } from 'kysely';

/**
 * Instrument 1 during the baseline (before alerts exist): route logs completed by hand, and the
 * `instrument1_export` view that unites them with the system's trip log (`source` tells them
 * apart). Times of day are local (America/Lima); the view turns them into timestamps.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE baseline_route_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id uuid NOT NULL REFERENCES routes (id),
      service_date date NOT NULL,
      vehicle_label text CHECK (length(vehicle_label) BETWEEN 1 AND 80),
      planned_start time,
      actual_start time,
      notes text CHECK (length(notes) <= 1000),
      created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`.execute(db);
  await sql`CREATE INDEX baseline_route_logs_route_date_idx ON baseline_route_logs (route_id, service_date DESC)`.execute(
    db,
  );
  await sql`
    CREATE TABLE baseline_point_passes (
      log_id uuid NOT NULL REFERENCES baseline_route_logs (id) ON DELETE CASCADE,
      point_id uuid NOT NULL REFERENCES reference_points (id),
      passed_at time NOT NULL,
      PRIMARY KEY (log_id, point_id)
    )`.execute(db);

  await sql`
    CREATE VIEW instrument1_export AS
    SELECT
      'system'::text AS source,
      log.trip_id AS record_id,
      log.service_date,
      log.route_code,
      log.vehicle_code AS vehicle,
      log.planned_start,
      log.actual_start,
      log.point_sequence,
      log.point_code,
      log.actual_passed_at,
      log.alert_emitted_at,
      log.communicated_eta,
      log.abs_error_minutes,
      log.point_incidents_count,
      NULL::text AS notes
    FROM instrument1_route_log log
    UNION ALL
    SELECT
      'baseline_manual'::text,
      l.id,
      to_char(l.service_date, 'YYYY-MM-DD'),
      r.code,
      l.vehicle_label,
      to_char(l.planned_start, 'HH24:MI:SS'),
      (l.service_date + l.actual_start) AT TIME ZONE 'America/Lima',
      p.sequence,
      p.code,
      (l.service_date + bp.passed_at) AT TIME ZONE 'America/Lima',
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::double precision,
      NULL::integer,
      l.notes
    FROM baseline_route_logs l
    JOIN routes r ON r.id = l.route_id
    JOIN reference_points p ON p.route_id = l.route_id
    LEFT JOIN baseline_point_passes bp ON bp.log_id = l.id AND bp.point_id = p.id
    WHERE p.active OR bp.point_id IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS instrument1_export`.execute(db);
  await sql`DROP TABLE IF EXISTS baseline_point_passes`.execute(db);
  await sql`DROP TABLE IF EXISTS baseline_route_logs`.execute(db);
}
