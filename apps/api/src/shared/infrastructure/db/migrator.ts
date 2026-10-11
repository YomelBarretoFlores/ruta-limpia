import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';

import type { Logger } from '../../application/logger.js';
import * as initialSchema from './migrations/0001-initial-schema.js';
import * as pushSubscriptions from './migrations/0002-push-subscriptions.js';
import * as appViews from './migrations/0003-app-views.js';
import * as appViewsHouseholdSetNull from './migrations/0004-app-views-household-set-null.js';
import * as panelAuth from './migrations/0005-panel-auth.js';
import * as panelOperations from './migrations/0006-panel-operations.js';
import * as householdRegistry from './migrations/0007-household-registry.js';
import * as fieldObservations from './migrations/0008-field-observations.js';
import * as baselineRouteLogs from './migrations/0009-baseline-route-logs.js';
import * as incidentLegacyData from './migrations/0010-incident-legacy-data.js';
import * as householdCodeCounter from './migrations/0011-household-code-counter.js';
import * as accountThrottle from './migrations/0012-account-throttle.js';

/**
 * Migrations are registered in code (not discovered on disk) so they work the same from `src` with
 * tsx and from the compiled `dist`. Names sort in execution order; never rename an applied one.
 */
const MIGRATIONS: Record<string, Migration> = {
  '0001-initial-schema': initialSchema,
  '0002-push-subscriptions': pushSubscriptions,
  '0003-app-views': appViews,
  '0004-app-views-household-set-null': appViewsHouseholdSetNull,
  '0005-panel-auth': panelAuth,
  '0006-panel-operations': panelOperations,
  '0007-household-registry': householdRegistry,
  '0008-field-observations': fieldObservations,
  '0009-baseline-route-logs': baselineRouteLogs,
  '0010-incident-legacy-data': incidentLegacyData,
  '0011-household-code-counter': householdCodeCounter,
  '0012-account-throttle': accountThrottle,
};

export function createMigrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({ db, provider: { getMigrations: () => Promise.resolve(MIGRATIONS) } });
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/** Applies every pending migration; throws (after logging each step) when one fails. */
export async function migrateToLatest<DB>(db: Kysely<DB>, logger: Logger): Promise<void> {
  report(await createMigrator(db).migrateToLatest(), logger);
}

function report({ error, results }: MigrationResultSet, logger: Logger): void {
  for (const result of results ?? []) {
    const context = { migration: result.migrationName, direction: result.direction };
    if (result.status === 'Success') logger.info(context, 'Migration applied');
    else if (result.status === 'Error') logger.error(context, 'Migration failed');
  }
  if (error !== undefined) {
    throw new MigrationError('Database migration failed', { cause: error });
  }
}
