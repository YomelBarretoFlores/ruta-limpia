import { sql, type Kysely } from 'kysely';

/**
 * Per-account throttling (NIST SP 800-63B style) instead of a low hard lock: the last counted
 * failure (attempts must wait a growing interval after it) and the start of the 24-hour window
 * in which 100 failures pause the account. `failed_attempts` keeps counting the failures of that
 * window.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
      ADD COLUMN last_failed_at timestamptz,
      ADD COLUMN failure_window_started_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
      DROP COLUMN IF EXISTS last_failed_at,
      DROP COLUMN IF EXISTS failure_window_started_at`.execute(db);
}
