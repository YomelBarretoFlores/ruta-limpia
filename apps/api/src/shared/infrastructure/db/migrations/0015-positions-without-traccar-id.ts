import { sql, type Kysely } from 'kysely';

/**
 * Traccar 6.16 forwards a position before its database handler stores it (the forwarding handler
 * runs first in its pipeline), so a forwarded position may carry `id: 0`, and its retry the stored
 * id. A position is therefore recognized by its vehicle and fix time, not only by the Traccar id:
 *
 * - `traccar_position_id` becomes nullable (null: forwarded before Traccar stored it; the UNIQUE
 *   constraint allows several nulls);
 * - one position per vehicle and fix time (`positions_vehicle_fix_time_key`, which also replaces
 *   the plain index on those columns). Rows already repeating a vehicle and fix time are replays
 *   of the same fix: the first one stored is kept. Nothing references positions by id.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE positions ALTER COLUMN traccar_position_id DROP NOT NULL`.execute(db);
  await sql`
    DELETE FROM positions p
    USING positions kept
    WHERE kept.vehicle_id = p.vehicle_id AND kept.fix_time = p.fix_time AND kept.id < p.id`.execute(
    db,
  );
  await sql`
    CREATE UNIQUE INDEX positions_vehicle_fix_time_key ON positions (vehicle_id, fix_time)`.execute(
    db,
  );
  await sql`DROP INDEX positions_vehicle_fix_time_idx`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX positions_vehicle_fix_time_idx ON positions (vehicle_id, fix_time DESC)`.execute(
    db,
  );
  await sql`DROP INDEX positions_vehicle_fix_time_key`.execute(db);
  // Positions without a Traccar id get a negative one (never a real Traccar id) to restore NOT NULL.
  await sql`UPDATE positions SET traccar_position_id = -id WHERE traccar_position_id IS NULL`.execute(
    db,
  );
  await sql`ALTER TABLE positions ALTER COLUMN traccar_position_id SET NOT NULL`.execute(db);
}
