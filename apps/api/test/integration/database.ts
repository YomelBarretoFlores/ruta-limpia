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
    TRUNCATE incidents, alerts, trip_point_passes, positions, trips, vehicles,
      reference_points, route_schedules, routes
    RESTART IDENTITY CASCADE`.execute(db);
}
