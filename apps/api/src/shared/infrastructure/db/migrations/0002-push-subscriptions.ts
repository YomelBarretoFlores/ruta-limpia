import { sql, type Kysely } from 'kysely';

/**
 * Households, Web Push subscriptions and per-subscription alert deliveries.
 *
 * Privacy by design: a household is a code and a public reference point, never an address, a name
 * or a phone number. A subscription follows one reference point and stores only the push endpoint
 * and keys, the consent, and the SHA-256 hash of its management token.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Lets households reference (point, route) together, so a point always belongs to its route.
  await sql`ALTER TABLE reference_points ADD CONSTRAINT reference_points_id_route_key UNIQUE (id, route_id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE households (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
      route_id uuid NOT NULL REFERENCES routes (id),
      point_id uuid NOT NULL,
      enrolled_at timestamptz NOT NULL,
      consent_at timestamptz NOT NULL,
      consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 32),
      active boolean NOT NULL DEFAULT true,
      notes text,
      FOREIGN KEY (point_id, route_id) REFERENCES reference_points (id, route_id)
    )`.execute(db);

  await sql`
    CREATE TABLE push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
      p256dh text NOT NULL,
      auth text NOT NULL,
      point_id uuid NOT NULL REFERENCES reference_points (id),
      household_id uuid REFERENCES households (id),
      consent_at timestamptz NOT NULL,
      consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 32),
      management_token_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      revoke_reason text CHECK (revoke_reason IN ('user_cancelled', 'expired', 'too_many_failures')),
      last_success_at timestamptz,
      consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
      CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
    )`.execute(db);
  await sql`CREATE INDEX push_subscriptions_active_point_idx ON push_subscriptions (point_id) WHERE revoked_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX push_subscriptions_household_idx ON push_subscriptions (household_id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE alert_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_id uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
      subscription_id uuid NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
      status text NOT NULL CHECK (status IN ('sent', 'failed', 'expired')),
      http_status integer,
      sent_at timestamptz NOT NULL,
      received_at timestamptz,
      UNIQUE (alert_id, subscription_id)
    )`.execute(db);
  await sql`CREATE INDEX alert_deliveries_subscription_idx ON alert_deliveries (subscription_id, sent_at)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['alert_deliveries', 'push_subscriptions', 'households']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
  await sql`ALTER TABLE reference_points DROP CONSTRAINT IF EXISTS reference_points_id_route_key`.execute(
    db,
  );
}
