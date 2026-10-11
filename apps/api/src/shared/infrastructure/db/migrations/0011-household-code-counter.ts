import { sql, type Kysely } from 'kysely';

/**
 * The last household code handed out (`H-###`), so a code is never reused after its household is
 * deleted: the printed sticker with its QR link may still be on the old door. One row, seeded with
 * the highest generated code already in use.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE household_code_counter (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      last_sequence integer NOT NULL CHECK (last_sequence >= 0)
    )`.execute(db);
  await sql`
    INSERT INTO household_code_counter (singleton, last_sequence)
    SELECT true, coalesce(max(substring(code FROM 3)::integer), 0)
    FROM households WHERE code ~ '^H-[0-9]{3,}$'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS household_code_counter`.execute(db);
}
