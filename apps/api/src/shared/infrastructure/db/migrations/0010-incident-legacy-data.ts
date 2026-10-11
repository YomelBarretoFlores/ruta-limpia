import { sql, type Kysely } from 'kysely';

/**
 * Brings incidents recorded before `0006-panel-operations` under its rules, then validates them.
 * Nothing is deleted; each row is fixed in one statement (the constraints already hold for any
 * changed row) and what had to change is kept at the start of its description:
 *
 * - a kind outside the closed list becomes `other`, prefixed `[legacy kind: <kind>]`;
 * - a point of another route is cleared, prefixed `[point <code> is not on this route]`;
 * - the description is cut to 1000 characters (the only lossy step).
 *
 * On a database whose incidents already satisfy the rules this changes nothing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    WITH checked AS (
      SELECT i.id,
        i.kind NOT IN ('truck_breakdown', 'route_change', 'gps_failure', 'alert_failure',
          'missed_collection', 'weather', 'other') AS legacy_kind,
        i.point_id IS NOT NULL AND p.route_id IS DISTINCT FROM i.route_id AS foreign_point,
        p.code AS point_code
      FROM incidents i
      LEFT JOIN reference_points p ON p.id = i.point_id
    )
    UPDATE incidents AS i SET
      kind = CASE WHEN c.legacy_kind THEN 'other' ELSE i.kind END,
      point_id = CASE WHEN c.foreign_point THEN NULL ELSE i.point_id END,
      description = left(
        CASE WHEN c.legacy_kind THEN '[legacy kind: ' || i.kind || '] ' ELSE '' END ||
        CASE WHEN c.foreign_point
          THEN '[point ' || coalesce(c.point_code, '?') || ' is not on this route] ' ELSE '' END ||
        i.description,
        1000)
    FROM checked c
    WHERE c.id = i.id AND (c.legacy_kind OR c.foreign_point OR length(i.description) > 1000)
  `.execute(db);
  await sql`
    ALTER TABLE incidents
      VALIDATE CONSTRAINT incidents_kind_check,
      VALIDATE CONSTRAINT incidents_description_length,
      VALIDATE CONSTRAINT incidents_point_route_fkey`.execute(db);
}

/** The mapped rows cannot be told apart from new ones, so there is nothing to undo. */
export async function down(): Promise<void> {
  // Intentionally empty.
}
