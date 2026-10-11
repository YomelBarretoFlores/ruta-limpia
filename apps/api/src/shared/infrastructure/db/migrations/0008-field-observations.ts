import { sql, type Kysely } from 'kysely';

/**
 * Instrument 2 (point observation sheet), one row per point and visit. Times of day are local
 * (America/Lima). Photos are never stored: only whether one was taken and its archive code.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE field_observations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id uuid NOT NULL REFERENCES routes (id),
      point_id uuid NOT NULL,
      trip_id uuid REFERENCES trips (id) ON DELETE SET NULL,
      observed_on date NOT NULL,
      phase text NOT NULL CHECK (phase IN ('baseline', 'intervention', 'post')),
      observers text NOT NULL CHECK (length(observers) BETWEEN 1 AND 200),
      first_placement_time time,
      truck_pass_time time,
      exposure_minutes integer CHECK (exposure_minutes BETWEEN 0 AND 1440),
      exposure_computed boolean NOT NULL DEFAULT false,
      bags_at_pass integer CHECK (bags_at_pass BETWEEN 0 AND 999),
      broken_bags integer CHECK (broken_bags BETWEEN 0 AND 999),
      dispersion text CHECK (dispersion IN ('none', 'few', 'many')),
      dispersion_causes text[] NOT NULL DEFAULT '{}' CHECK (
        dispersion_causes <@ ARRAY['animals', 'wind', 'manipulation', 'undetermined', 'other']),
      dispersion_cause_other text CHECK (length(dispersion_cause_other) <= 200),
      waste_remaining_after_pass boolean,
      photo_before_taken boolean NOT NULL DEFAULT false,
      photo_before_code text CHECK (photo_before_code ~ '^[A-Za-z0-9_-]{1,40}$'),
      photo_after_taken boolean NOT NULL DEFAULT false,
      photo_after_code text CHECK (photo_after_code ~ '^[A-Za-z0-9_-]{1,40}$'),
      music_window_start time,
      music_window_end time,
      music_seconds integer CHECK (music_seconds >= 0),
      music_conditions text CHECK (length(music_conditions) <= 300),
      notes text CHECK (length(notes) <= 1000),
      created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      FOREIGN KEY (point_id, route_id) REFERENCES reference_points (id, route_id),
      CHECK ((music_window_start IS NULL) = (music_window_end IS NULL)
        AND (music_window_start IS NULL) = (music_seconds IS NULL))
    )`.execute(db);
  await sql`CREATE INDEX field_observations_route_date_idx ON field_observations (route_id, observed_on DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX field_observations_creator_idx ON field_observations (created_by_user_id)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS field_observations`.execute(db);
}
