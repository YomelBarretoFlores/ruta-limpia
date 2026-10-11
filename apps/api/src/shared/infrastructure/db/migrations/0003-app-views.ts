import { sql, type Kysely } from 'kysely';

/**
 * App views ("consultas") for the adoption indicator: households with at least one view or one
 * alert received per week.
 *
 * Privacy by design: a view stores the reference point and the time, plus the subscription and its
 * household only when the browser proved it holds the subscription's management token. No IP
 * address, user agent or any other client identifier is stored.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      point_id uuid NOT NULL REFERENCES reference_points (id),
      subscription_id uuid REFERENCES push_subscriptions (id) ON DELETE SET NULL,
      household_id uuid REFERENCES households (id),
      viewed_at timestamptz NOT NULL
    )`.execute(db);
  await sql`CREATE INDEX app_views_viewed_at_idx ON app_views (viewed_at)`.execute(db);
  await sql`CREATE INDEX app_views_household_idx ON app_views (household_id, viewed_at) WHERE household_id IS NOT NULL`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS app_views`.execute(db);
}
