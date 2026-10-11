import { sql, type Kysely } from 'kysely';

/**
 * Inputs of the impact indicators (Tabla 16) that were not stored yet:
 *
 * - two Instrument 2 flags on `field_observations`: `exposure_incomplete` (the first placement
 *   happened before the observation began, so the exposure is a minimum time and stays out of the
 *   median) and `comparable_window` ("mismo punto y ventana": false keeps the sheet out of the
 *   window comparisons; null when not answered);
 * - `household_surveys`, Instrument 3 (Tabla 19): one row per household and wave (`pre`,
 *   `post`), linked by the household only (never an address). Questions 6–11 exist only in the
 *   post wave; "No la escuché" (Q12) is its own flag, never a zero annoyance. Deleting a
 *   household (consent withdrawn) deletes its surveys.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE field_observations
      ADD COLUMN exposure_incomplete boolean NOT NULL DEFAULT false,
      ADD COLUMN comparable_window boolean`.execute(db);

  await sql`
    CREATE TABLE household_surveys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
      wave text NOT NULL CHECK (wave IN ('pre', 'post')),
      surveyed_on date NOT NULL,
      q1_knows_schedule boolean,
      q2_lead_time text CHECK (q2_lead_time IN ('0_15', '15_60', '1_3h', 'gt_3h', 'after_pass')),
      q3_missed_pickups text CHECK (q3_missed_pickups IN ('0', '1_2', '3_plus')),
      q4_litter_seen text CHECK (q4_litter_seen IN ('never', 'sometimes', 'often')),
      q5_separates text CHECK (q5_separates IN ('yes', 'sometimes', 'no')),
      q6_alerts_helped smallint CHECK (q6_alerts_helped BETWEEN 1 AND 5),
      q7_easy_to_use smallint CHECK (q7_easy_to_use BETWEEN 1 AND 5),
      q8_eta_reliable smallint CHECK (q8_eta_reliable BETWEEN 1 AND 5),
      q9_street_cleaner smallint CHECK (q9_street_cleaner BETWEEN 1 AND 5),
      q10_keep_system smallint CHECK (q10_keep_system BETWEEN 1 AND 5),
      q11_satisfaction smallint CHECK (q11_satisfaction BETWEEN 1 AND 5),
      q12_annoyance smallint CHECK (q12_annoyance BETWEEN 0 AND 4),
      q12_not_heard boolean NOT NULL DEFAULT false,
      q13_interrupted text CHECK (q13_interrupted IN ('never', '1_2', '3_plus', 'not_heard')),
      q14_channels text[] NOT NULL DEFAULT '{}' CHECK (
        q14_channels <@ ARRAY['music', 'alert', 'web_map', 'printed_schedule', 'neighbor', 'other']),
      q14_other text CHECK (length(q14_other) <= 200),
      q15_access text CHECK (q15_access IN ('yes', 'with_help', 'no')),
      q15_alt_channel text CHECK (length(q15_alt_channel) <= 200),
      import_batch_id uuid,
      created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (household_id, wave),
      CHECK (wave = 'post' OR (q6_alerts_helped IS NULL AND q7_easy_to_use IS NULL
        AND q8_eta_reliable IS NULL AND q9_street_cleaner IS NULL AND q10_keep_system IS NULL
        AND q11_satisfaction IS NULL)),
      CHECK (NOT (q12_not_heard AND q12_annoyance IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX household_surveys_wave_idx ON household_surveys (wave, surveyed_on)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS household_surveys`.execute(db);
  await sql`
    ALTER TABLE field_observations
      DROP COLUMN IF EXISTS exposure_incomplete,
      DROP COLUMN IF EXISTS comparable_window`.execute(db);
}
