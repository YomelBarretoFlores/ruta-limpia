import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { AppDatabase, Database } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  HouseholdSurveyStore,
  StoredSurvey,
  SurveyFilter,
  SurveyRecord,
} from '../application/household-survey-service.js';
import type { Channel } from '../domain/household-survey.js';

const UNIQUE_VIOLATION = '23505';

function records(db: Kysely<Database>) {
  return db
    .selectFrom('household_surveys as s')
    .innerJoin('households as h', 'h.id', 's.household_id')
    .innerJoin('routes as r', 'r.id', 'h.route_id')
    .selectAll('s')
    .select([
      'h.code as household_code',
      'r.code as route_code',
      sql<string>`to_char(s.surveyed_on, 'YYYY-MM-DD')`.as('surveyed_on_text'),
    ]);
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof records>['executeTakeFirstOrThrow']>>;

function toRecord(row: RecordRow): SurveyRecord {
  return {
    id: row.id,
    householdId: row.household_id,
    householdCode: row.household_code,
    routeCode: row.route_code,
    wave: row.wave,
    surveyedOn: row.surveyed_on_text,
    knowsSchedule: row.q1_knows_schedule,
    leadTime: row.q2_lead_time,
    missedPickups: row.q3_missed_pickups,
    litterSeen: row.q4_litter_seen,
    separates: row.q5_separates,
    alertsHelped: row.q6_alerts_helped,
    easyToUse: row.q7_easy_to_use,
    etaReliable: row.q8_eta_reliable,
    streetCleaner: row.q9_street_cleaner,
    keepSystem: row.q10_keep_system,
    satisfaction: row.q11_satisfaction,
    annoyance: row.q12_annoyance,
    notHeard: row.q12_not_heard,
    interrupted: row.q13_interrupted,
    channels: row.q14_channels as Channel[],
    channelOther: row.q14_other,
    access: row.q15_access,
    altChannel: row.q15_alt_channel,
    importBatchId: row.import_batch_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function columns(s: StoredSurvey) {
  return {
    household_id: s.householdId,
    wave: s.wave,
    surveyed_on: s.surveyedOn,
    q1_knows_schedule: s.knowsSchedule,
    q2_lead_time: s.leadTime,
    q3_missed_pickups: s.missedPickups,
    q4_litter_seen: s.litterSeen,
    q5_separates: s.separates,
    q6_alerts_helped: s.alertsHelped,
    q7_easy_to_use: s.easyToUse,
    q8_eta_reliable: s.etaReliable,
    q9_street_cleaner: s.streetCleaner,
    q10_keep_system: s.keepSystem,
    q11_satisfaction: s.satisfaction,
    q12_annoyance: s.annoyance,
    q12_not_heard: s.notHeard,
    q13_interrupted: s.interrupted,
    q14_channels: [...s.channels],
    q14_other: s.channelOther,
    q15_access: s.access,
    q15_alt_channel: s.altChannel,
  };
}

/** Instrument 3 surveys in PostgreSQL (`household_surveys`). */
export class KyselyHouseholdSurveyStore implements HouseholdSurveyStore {
  constructor(private readonly db: AppDatabase) {}

  async insert(
    survey: StoredSurvey,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<SurveyRecord | null> {
    const row = await this.db
      .insertInto('household_surveys')
      .values({
        ...columns(survey),
        created_by_user_id: meta.createdByUserId,
        created_at: meta.at,
        updated_at: meta.at,
      })
      .onConflict((oc) => oc.columns(['household_id', 'wave']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row === undefined) return null;
    return toRecord(await records(this.db).where('s.id', '=', row.id).executeTakeFirstOrThrow());
  }

  async findById(id: string): Promise<SurveyRecord | null> {
    if (!isUuid(id)) return null;
    const row = await records(this.db).where('s.id', '=', id).executeTakeFirst();
    return row === undefined ? null : toRecord(row);
  }

  async update(
    id: string,
    survey: StoredSurvey,
    at: Date,
  ): Promise<SurveyRecord | 'not_found' | 'duplicate'> {
    if (!isUuid(id)) return 'not_found';
    try {
      const updated = await this.db
        .updateTable('household_surveys')
        .set({ ...columns(survey), import_batch_id: null, updated_at: at })
        .where('id', '=', id)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return 'not_found';
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'duplicate';
      throw error;
    }
    const row = await records(this.db).where('s.id', '=', id).executeTakeFirst();
    return row === undefined ? 'not_found' : toRecord(row);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db
      .deleteFrom('household_surveys')
      .where('id', '=', id)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }

  async list(
    filter: SurveyFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: SurveyRecord[]; total: number }> {
    let scope = records(this.db);
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.wave !== undefined) scope = scope.where('s.wave', '=', filter.wave);
    if (filter.householdCode !== undefined) {
      scope = scope.where('h.code', '=', filter.householdCode);
    }
    const [rows, count] = await Promise.all([
      scope
        .orderBy('h.code')
        .orderBy('s.wave', 'desc')
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      scope
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow(),
    ]);
    return { items: rows.map(toRecord), total: Number(count.total) };
  }

  async upsertMany(
    surveys: readonly StoredSurvey[],
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<{ batchId: string; created: number; updated: number }> {
    const batchId = randomUUID();
    if (surveys.length === 0) return { batchId, created: 0, updated: 0 };
    const rows = await this.db
      .insertInto('household_surveys')
      .values(
        surveys.map((survey) => ({
          ...columns(survey),
          import_batch_id: batchId,
          created_by_user_id: meta.createdByUserId,
          created_at: meta.at,
          updated_at: meta.at,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['household_id', 'wave']).doUpdateSet((eb) => ({
          ...Object.fromEntries(
            Object.keys(columns(surveys[0] as StoredSurvey))
              .filter((column) => column !== 'household_id' && column !== 'wave')
              .map((column) => [column, eb.ref(`excluded.${column}` as 'excluded.surveyed_on')]),
          ),
          import_batch_id: batchId,
          updated_at: meta.at,
        })),
      )
      // xmax is 0 for a row this statement inserted, non-zero for one it updated.
      .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
      .execute();
    const created = rows.filter((r) => r.inserted).length;
    return { batchId, created, updated: rows.length - created };
  }

  async householdsByCode(codes: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('households')
      .select(['id', 'code'])
      .where('code', 'in', [...codes])
      .execute();
    return new Map(rows.map((r) => [r.code, r.id]));
  }
}
