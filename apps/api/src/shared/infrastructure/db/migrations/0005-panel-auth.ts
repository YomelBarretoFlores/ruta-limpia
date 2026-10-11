import { sql, type Kysely } from 'kysely';

/**
 * Municipal panel access: users with roles, server-side sessions and the audit trail.
 *
 * - Usernames are unique case-insensitively and stored in lower case.
 * - A session stores only the SHA-256 of its cookie token, so a database leak yields no usable
 *   cookie; deleting a user deletes their sessions.
 * - Audit events keep their row when the acting user is deleted (`user_id` becomes null).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
      role text NOT NULL CHECK (role IN ('admin', 'supervisor', 'observer')),
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX users_username_key ON users (lower(username))`.execute(db);

  await sql`
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      user_agent_class text CHECK (user_agent_class IN ('mobile', 'desktop', 'other')),
      created_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CHECK (expires_at > created_at)
    )`.execute(db);
  await sql`CREATE INDEX sessions_user_idx ON sessions (user_id)`.execute(db);

  await sql`
    CREATE TABLE audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      action text NOT NULL,
      entity text NOT NULL,
      entity_id text,
      at timestamptz NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb
    )`.execute(db);
  await sql`CREATE INDEX audit_events_at_idx ON audit_events (at DESC, id DESC)`.execute(db);
  await sql`CREATE INDEX audit_events_entity_idx ON audit_events (entity, entity_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['audit_events', 'sessions', 'users']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
}
