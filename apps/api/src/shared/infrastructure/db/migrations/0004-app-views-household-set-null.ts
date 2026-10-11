import { sql, type Kysely } from 'kysely';

/**
 * A deleted household keeps its app views for the indicators, without the household link (as a
 * deleted subscription already does through `app_views.subscription_id`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app_views
      DROP CONSTRAINT app_views_household_id_fkey,
      ADD CONSTRAINT app_views_household_id_fkey
        FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app_views
      DROP CONSTRAINT app_views_household_id_fkey,
      ADD CONSTRAINT app_views_household_id_fkey
        FOREIGN KEY (household_id) REFERENCES households (id)`.execute(db);
}
