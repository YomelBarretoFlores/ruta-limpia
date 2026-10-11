import { sql, type Kysely } from 'kysely';

import type { AppDatabase, Database } from '../../shared/infrastructure/db/database.js';
import type {
  HouseholdFilter,
  HouseholdListItem,
  HouseholdRecord,
  HouseholdStore,
  NewHousehold,
} from '../application/household-registry.js';
import { householdCodeSequence, nextHouseholdCode } from '../domain/household-code.js';

/** Key of the transaction-level advisory lock that serializes code generation. */
const CODE_LOCK_KEY = 'ruta-limpia:household-code';

function records(db: Kysely<Database>) {
  return db
    .selectFrom('households as h')
    .innerJoin('routes as r', 'r.id', 'h.route_id')
    .innerJoin('reference_points as p', 'p.id', 'h.point_id')
    .select([
      'h.id',
      'h.code',
      'h.route_id',
      'r.code as route_code',
      'p.code as point_code',
      'h.enrolled_at',
      'h.consent_at',
      'h.consent_version',
      'h.active',
      'h.notes',
      'h.updated_at',
    ]);
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof records>['executeTakeFirstOrThrow']>>;

function toRecord(row: RecordRow): HouseholdRecord {
  return {
    id: row.id,
    code: row.code,
    routeId: row.route_id,
    routeCode: row.route_code,
    pointCode: row.point_code,
    enrolledAt: row.enrolled_at,
    consentAt: row.consent_at,
    consentVersion: row.consent_version,
    active: row.active,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

/** The household registry in PostgreSQL (`households`). */
export class KyselyHouseholdStore implements HouseholdStore {
  constructor(private readonly db: AppDatabase) {}

  insertWithNextCode(household: NewHousehold): Promise<HouseholdRecord> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${CODE_LOCK_KEY}))`.execute(trx);
      const codes = await trx
        .selectFrom('households')
        .select('code')
        .where('code', '~', '^H-[0-9]{3,}$')
        .execute();
      const highest = codes.reduce<number | null>((max, { code }) => {
        const sequence = householdCodeSequence(code);
        return sequence === null ? max : Math.max(max ?? 0, sequence);
      }, null);
      const row = await trx
        .insertInto('households')
        .values({
          code: nextHouseholdCode(highest),
          route_id: household.routeId,
          point_id: household.pointId,
          enrolled_at: household.enrolledAt,
          consent_at: household.consentAt,
          consent_version: household.consentVersion,
          notes: household.notes,
          created_by_user_id: household.createdByUserId,
          updated_at: household.enrolledAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return toRecord(await records(trx).where('h.id', '=', row.id).executeTakeFirstOrThrow());
    });
  }

  async findByCode(code: string): Promise<HouseholdRecord | null> {
    const row = await records(this.db).where('h.code', '=', code).executeTakeFirst();
    return row === undefined ? null : toRecord(row);
  }

  async update(
    id: string,
    changes: {
      readonly pointId?: string;
      readonly active?: boolean;
      readonly notes?: string | null;
    },
    at: Date,
  ): Promise<HouseholdRecord> {
    await this.db
      .updateTable('households')
      .set({
        updated_at: at,
        ...(changes.pointId === undefined ? {} : { point_id: changes.pointId }),
        ...(changes.active === undefined ? {} : { active: changes.active }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
      })
      .where('id', '=', id)
      .execute();
    return toRecord(await records(this.db).where('h.id', '=', id).executeTakeFirstOrThrow());
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('households').where('id', '=', id).execute();
  }

  async list(
    filter: HouseholdFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: HouseholdListItem[]; total: number }> {
    let scope = records(this.db);
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.pointCode !== undefined) scope = scope.where('p.code', '=', filter.pointCode);
    if (filter.active !== undefined) scope = scope.where('h.active', '=', filter.active);
    const [rows, count] = await Promise.all([
      scope
        .select((eb) => [
          eb
            .selectFrom('push_subscriptions as s')
            .select((sub) => sub.fn.countAll<string>().as('n'))
            .whereRef('s.household_id', '=', 'h.id')
            .where('s.revoked_at', 'is', null)
            .as('active_subscriptions'),
          eb
            .selectFrom('alert_deliveries as d')
            .innerJoin('push_subscriptions as s', 's.id', 'd.subscription_id')
            .select((sub) => sub.fn.max('d.received_at').as('at'))
            .whereRef('s.household_id', '=', 'h.id')
            .as('last_alert_received_at'),
          eb
            .selectFrom('app_views as v')
            .select((sub) => sub.fn.max('v.viewed_at').as('at'))
            .whereRef('v.household_id', '=', 'h.id')
            .as('last_app_view_at'),
        ])
        // H-099 before H-100 before H-1000.
        .orderBy(sql`length(h.code)`)
        .orderBy('h.code')
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      scope
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow(),
    ]);
    return {
      total: Number(count.total),
      items: rows.map((row) => ({
        ...toRecord(row),
        activeSubscriptions: Number(row.active_subscriptions ?? 0),
        lastAlertReceivedAt: row.last_alert_received_at ?? null,
        lastAppViewAt: row.last_app_view_at ?? null,
      })),
    };
  }
}
