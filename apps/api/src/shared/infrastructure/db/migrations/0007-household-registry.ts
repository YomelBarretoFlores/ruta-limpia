import { sql, type Kysely } from 'kysely';

/**
 * Household registry managed from the panel: who enrolled the household and when it last changed.
 * Deleting a household (administrators only; deactivation is the normal path) keeps its push
 * subscriptions, without the household link.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE push_subscriptions
      DROP CONSTRAINT push_subscriptions_household_id_fkey,
      ADD CONSTRAINT push_subscriptions_household_id_fkey
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE SET NULL`.execute(db);
  await sql`
    ALTER TABLE households
      ADD COLUMN created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
      ADD CONSTRAINT households_notes_length CHECK (length(notes) <= 280)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE households
      DROP CONSTRAINT IF EXISTS households_notes_length,
      DROP COLUMN IF EXISTS updated_at,
      DROP COLUMN IF EXISTS created_by_user_id`.execute(db);
  await sql`
    ALTER TABLE push_subscriptions
      DROP CONSTRAINT push_subscriptions_household_id_fkey,
      ADD CONSTRAINT push_subscriptions_household_id_fkey
        FOREIGN KEY (household_id) REFERENCES households (id)`.execute(db);
}
