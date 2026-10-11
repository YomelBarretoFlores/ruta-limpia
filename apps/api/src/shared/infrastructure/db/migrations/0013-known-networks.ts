import { sql, type Kysely } from 'kysely';

/**
 * The account throttle reserves an attempt's slot before the password check, and spares the
 * owner's own networks:
 *
 * - `last_failed_at` becomes `last_attempt_at`: the last attempt checked against the password (a
 *   counted failure, or an admitted attempt whose slot was reserved under the row lock);
 * - `failed_attempts` now counts the consecutive failures since the last successful sign-in (the
 *   spacing), and the new `window_failures` counts every failure of the 24-hour window (the hard
 *   pause), which a successful sign-in does not reset;
 * - `user_known_networks`: the client networks (IPv4 /24, IPv6 /64) each account signed in from
 *   successfully, as the SHA-256 of the user id and the network (never an address), with the time
 *   of the last such sign-in. Entries older than 30 days are deleted at each successful sign-in;
 *   deleting a user deletes theirs.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users RENAME COLUMN last_failed_at TO last_attempt_at`.execute(db);
  await sql`
    ALTER TABLE users
      ADD COLUMN window_failures integer NOT NULL DEFAULT 0 CHECK (window_failures >= 0)`.execute(
    db,
  );
  await sql`UPDATE users SET window_failures = failed_attempts`.execute(db);
  await sql`
    CREATE TABLE user_known_networks (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      network_hash text NOT NULL CHECK (network_hash ~ '^[0-9a-f]{64}$'),
      last_seen_at timestamptz NOT NULL,
      PRIMARY KEY (user_id, network_hash)
    )`.execute(db);
  await sql`
    CREATE INDEX user_known_networks_last_seen_idx ON user_known_networks (last_seen_at)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_known_networks`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS window_failures`.execute(db);
  await sql`ALTER TABLE users RENAME COLUMN last_attempt_at TO last_failed_at`.execute(db);
}
