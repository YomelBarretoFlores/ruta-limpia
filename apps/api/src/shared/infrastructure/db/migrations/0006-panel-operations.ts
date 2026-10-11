import { sql, type Kysely } from 'kysely';

/**
 * Panel operations: the operator's note when a trip is ended by hand, and incident tracking
 * (closed list of kinds, reporting user, resolution). An incident's point must belong to its route.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE trips ADD COLUMN end_note text CHECK (length(end_note) <= 500)`.execute(db);

  await sql`
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_kind_check CHECK (kind IN (
        'truck_breakdown', 'route_change', 'gps_failure', 'alert_failure', 'missed_collection',
        'weather', 'other')),
      ADD CONSTRAINT incidents_description_length CHECK (length(description) <= 1000),
      ADD CONSTRAINT incidents_point_route_fkey
        FOREIGN KEY (point_id, route_id) REFERENCES reference_points (id, route_id),
      ADD COLUMN reported_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN resolved_at timestamptz,
      ADD COLUMN resolved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN resolution_note text CHECK (length(resolution_note) <= 1000),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`.execute(db);
  await sql`CREATE INDEX incidents_route_occurred_idx ON incidents (route_id, occurred_at DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS incidents_route_occurred_idx`.execute(db);
  await sql`
    ALTER TABLE incidents
      DROP CONSTRAINT IF EXISTS incidents_kind_check,
      DROP CONSTRAINT IF EXISTS incidents_description_length,
      DROP CONSTRAINT IF EXISTS incidents_point_route_fkey,
      DROP COLUMN IF EXISTS reported_by_user_id,
      DROP COLUMN IF EXISTS resolved_at,
      DROP COLUMN IF EXISTS resolved_by_user_id,
      DROP COLUMN IF EXISTS resolution_note,
      DROP COLUMN IF EXISTS updated_at`.execute(db);
  await sql`ALTER TABLE trips DROP COLUMN IF EXISTS end_note`.execute(db);
}
