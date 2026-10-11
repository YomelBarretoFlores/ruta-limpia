import { sql, type Kysely } from 'kysely';

import type { AppDatabase, Database } from '../../shared/infrastructure/db/database.js';
import { inTransaction } from '../../shared/infrastructure/db/kysely-unit-of-work.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import { hhmm } from './local-time.js';
import type {
  BaselineLogFilter,
  BaselineLogRecord,
  BaselineLogStore,
  StoredBaselineLog,
} from '../application/baseline-log-service.js';

function logs(db: Kysely<Database>) {
  return db
    .selectFrom('baseline_route_logs as l')
    .innerJoin('routes as r', 'r.id', 'l.route_id')
    .select([
      'l.id',
      'r.code as route_code',
      sql<string>`to_char(l.service_date, 'YYYY-MM-DD')`.as('service_date_text'),
      'l.vehicle_label',
      'l.planned_start',
      'l.actual_start',
      'l.notes',
      'l.created_by_user_id',
      'l.created_at',
      'l.updated_at',
    ]);
}

async function withPasses(
  db: Kysely<Database>,
  rows: Awaited<ReturnType<ReturnType<typeof logs>['execute']>>,
): Promise<BaselineLogRecord[]> {
  if (rows.length === 0) return [];
  const passes = await db
    .selectFrom('baseline_point_passes as bp')
    .innerJoin('reference_points as p', 'p.id', 'bp.point_id')
    .select(['bp.log_id', 'p.code', 'p.sequence', 'bp.passed_at'])
    .where(
      'bp.log_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('p.sequence')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    routeCode: row.route_code,
    serviceDate: row.service_date_text,
    vehicleLabel: row.vehicle_label,
    plannedStart: hhmm(row.planned_start),
    actualStart: hhmm(row.actual_start),
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passes: passes
      .filter((pass) => pass.log_id === row.id)
      .map((pass) => ({
        pointCode: pass.code,
        sequence: pass.sequence,
        passedAt: hhmm(pass.passed_at) ?? '',
      })),
  }));
}

async function writePasses(trx: Kysely<Database>, logId: string, log: StoredBaselineLog) {
  await trx.deleteFrom('baseline_point_passes').where('log_id', '=', logId).execute();
  if (log.passes.length === 0) return;
  await trx
    .insertInto('baseline_point_passes')
    .values(
      log.passes.map((pass) => ({
        log_id: logId,
        point_id: pass.pointId,
        passed_at: pass.passedAt,
      })),
    )
    .execute();
}

function content(log: StoredBaselineLog) {
  return {
    route_id: log.routeId,
    service_date: log.serviceDate,
    vehicle_label: log.vehicleLabel,
    planned_start: log.plannedStart,
    actual_start: log.actualStart,
    notes: log.notes,
  };
}

/** Baseline route logs in PostgreSQL (`baseline_route_logs`, `baseline_point_passes`). */
export class KyselyBaselineLogStore implements BaselineLogStore {
  constructor(private readonly db: AppDatabase) {}

  private async one(db: Kysely<Database>, id: string): Promise<BaselineLogRecord> {
    const [record] = await withPasses(db, await logs(db).where('l.id', '=', id).execute());
    if (record === undefined) throw new Error(`Baseline log ${id} vanished`);
    return record;
  }

  insert(
    log: StoredBaselineLog,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<BaselineLogRecord> {
    return inTransaction(this.db, async (trx) => {
      const row = await trx
        .insertInto('baseline_route_logs')
        .values({
          ...content(log),
          created_by_user_id: meta.createdByUserId,
          created_at: meta.at,
          updated_at: meta.at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writePasses(trx, row.id, log);
      return this.one(trx, row.id);
    });
  }

  async findById(id: string): Promise<BaselineLogRecord | null> {
    if (!isUuid(id)) return null;
    const [record] = await withPasses(
      this.db,
      await logs(this.db).where('l.id', '=', id).execute(),
    );
    return record ?? null;
  }

  update(id: string, log: StoredBaselineLog, at: Date): Promise<BaselineLogRecord | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return inTransaction(this.db, async (trx) => {
      // The UPDATE locks the row; zero rows means the log was deleted meanwhile, and no pass is
      // written for it.
      const updated = await trx
        .updateTable('baseline_route_logs')
        .set({ ...content(log), updated_at: at })
        .where('id', '=', id)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return null;
      await writePasses(trx, id, log);
      return this.one(trx, id);
    });
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db
      .deleteFrom('baseline_route_logs')
      .where('id', '=', id)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }

  async list(
    filter: BaselineLogFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: BaselineLogRecord[]; total: number }> {
    let scope = logs(this.db);
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.from !== undefined) scope = scope.where('l.service_date', '>=', filter.from);
    if (filter.to !== undefined) scope = scope.where('l.service_date', '<=', filter.to);
    if (filter.createdByUserId !== undefined) {
      scope = scope.where('l.created_by_user_id', '=', filter.createdByUserId);
    }
    const [rows, count] = await Promise.all([
      scope
        .orderBy('l.service_date', 'desc')
        .orderBy('l.created_at', 'desc')
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      scope
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow(),
    ]);
    return { items: await withPasses(this.db, rows), total: Number(count.total) };
  }
}
