import { sql } from 'kysely';
import { inject } from 'vitest';

import { createDatabase, type AppDatabase } from '../../src/shared/infrastructure/db/database.js';
import { migrateToLatest } from '../../src/shared/infrastructure/db/migrator.js';
import { SILENT_LOGGER } from '../../src/shared/application/logger.js';

/** Connects to the shared integration database and brings its schema up to date. */
export async function connectTestDatabase(): Promise<AppDatabase> {
  const db = createDatabase(inject('databaseUrl'), { poolMax: 10 });
  await migrateToLatest(db, SILENT_LOGGER);
  return db;
}

/** Removes every row of the application tables (the schema and migrations stay). */
export async function resetData(db: AppDatabase): Promise<void> {
  await sql`
    TRUNCATE baseline_point_passes, baseline_route_logs, field_observations, audit_events, sessions, users, app_views, alert_deliveries, push_subscriptions, households, incidents, alerts, trip_point_passes, positions, trips, vehicles,
      reference_points, route_schedules, routes
    RESTART IDENTITY CASCADE`.execute(db);
}

/**
 * Makes every insert of an audit event with `action` fail (a trigger), to prove that the action it
 * records rolls back with it. Call the returned function, in a `finally`, to remove the trigger.
 */
export async function failAuditWritesOf(
  db: AppDatabase,
  action: string,
): Promise<() => Promise<void>> {
  await sql`
    CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = TG_ARGV[0] THEN RAISE EXCEPTION 'audit write failed (test)'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER test_fail_audit BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION test_fail_audit(${sql.lit(action)})`.execute(db);
  return async () => {
    await sql`DROP TRIGGER IF EXISTS test_fail_audit ON audit_events`.execute(db);
  };
}
