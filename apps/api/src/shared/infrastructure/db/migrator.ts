import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';

import type { Logger } from '../../application/logger.js';
import * as initialSchema from './migrations/0001-initial-schema.js';

/**
 * Migrations are registered in code (not discovered on disk) so they work the same from `src` with
 * tsx and from the compiled `dist`. Names sort in execution order; never rename an applied one.
 */
const MIGRATIONS: Record<string, Migration> = {
  '0001-initial-schema': initialSchema,
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
