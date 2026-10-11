import { sql, type Kysely } from 'kysely';

import type { AppDatabase, Database } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  FieldObservationFilter,
  FieldObservationRecord,
  FieldObservationStore,
  StoredObservation,
} from '../application/field-observation-service.js';
import type { DispersionCause } from '../domain/point-observation.js';

/** `HH:MM:SS` from PostgreSQL → `HH:MM`. */
const hhmm = (time: string | null): string | null => (time === null ? null : time.slice(0, 5));

function records(db: Kysely<Database>) {
  return db
    .selectFrom('field_observations as o')
    .innerJoin('routes as r', 'r.id', 'o.route_id')
    .innerJoin('reference_points as p', 'p.id', 'o.point_id')
    .selectAll('o')
    .select([
      'r.code as route_code',
      'p.code as point_code',
      sql<string>`to_char(o.observed_on, 'YYYY-MM-DD')`.as('observed_on_text'),
    ]);
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof records>['executeTakeFirstOrThrow']>>;

function toRecord(row: RecordRow): FieldObservationRecord {
  const musicStart = hhmm(row.music_window_start);
  const musicEnd = hhmm(row.music_window_end);
  return {
    id: row.id,
    routeId: row.route_id,
    routeCode: row.route_code,
    pointCode: row.point_code,
    tripId: row.trip_id,
    observedOn: row.observed_on_text,
    phase: row.phase,
    observers: row.observers,
    notes: row.notes,
    firstPlacementTime: hhmm(row.first_placement_time),
    truckPassTime: hhmm(row.truck_pass_time),
    exposureMinutes: row.exposure_minutes,
    exposureComputed: row.exposure_computed,
    bagsAtPass: row.bags_at_pass,
    brokenBags: row.broken_bags,
    dispersion: row.dispersion,
    dispersionCauses: row.dispersion_causes as DispersionCause[],
    dispersionCauseOther: row.dispersion_cause_other,
    wasteRemainingAfterPass: row.waste_remaining_after_pass,
    photoBefore: { taken: row.photo_before_taken, code: row.photo_before_code },
    photoAfter: { taken: row.photo_after_taken, code: row.photo_after_code },
    music:
      musicStart === null || musicEnd === null || row.music_seconds === null
        ? null
        : {
            windowStart: musicStart,
            windowEnd: musicEnd,
            musicSeconds: row.music_seconds,
            conditions: row.music_conditions,
          },
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function columns(o: StoredObservation) {
  return {
    route_id: o.routeId,
    point_id: o.pointId,
    trip_id: o.tripId,
    observed_on: o.observedOn,
    phase: o.phase,
    observers: o.observers,
    notes: o.notes,
    first_placement_time: o.firstPlacementTime,
    truck_pass_time: o.truckPassTime,
    exposure_minutes: o.exposureMinutes,
    exposure_computed: o.exposureComputed,
    bags_at_pass: o.bagsAtPass,
    broken_bags: o.brokenBags,
    dispersion: o.dispersion,
    dispersion_causes: [...o.dispersionCauses],
    dispersion_cause_other: o.dispersionCauseOther,
    waste_remaining_after_pass: o.wasteRemainingAfterPass,
    photo_before_taken: o.photoBefore.taken,
    photo_before_code: o.photoBefore.code,
    photo_after_taken: o.photoAfter.taken,
    photo_after_code: o.photoAfter.code,
    music_window_start: o.music?.windowStart ?? null,
    music_window_end: o.music?.windowEnd ?? null,
    music_seconds: o.music?.musicSeconds ?? null,
    music_conditions: o.music?.conditions ?? null,
  };
}

/** Instrument 2 sheets in PostgreSQL (`field_observations`). */
export class KyselyFieldObservationStore implements FieldObservationStore {
  constructor(private readonly db: AppDatabase) {}

  async insert(
    observation: StoredObservation,
    meta: { readonly createdByUserId: string; readonly at: Date },
  ): Promise<FieldObservationRecord> {
    const row = await this.db
      .insertInto('field_observations')
      .values({
        ...columns(observation),
        created_by_user_id: meta.createdByUserId,
        created_at: meta.at,
        updated_at: meta.at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return toRecord(await records(this.db).where('o.id', '=', row.id).executeTakeFirstOrThrow());
  }

  async findById(id: string): Promise<FieldObservationRecord | null> {
    if (!isUuid(id)) return null;
    const row = await records(this.db).where('o.id', '=', id).executeTakeFirst();
    return row === undefined ? null : toRecord(row);
  }

  async update(
    id: string,
    observation: StoredObservation,
    at: Date,
  ): Promise<FieldObservationRecord> {
    await this.db
      .updateTable('field_observations')
      .set({ ...columns(observation), updated_at: at })
      .where('id', '=', id)
      .execute();
    return toRecord(await records(this.db).where('o.id', '=', id).executeTakeFirstOrThrow());
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('field_observations').where('id', '=', id).execute();
  }

  async list(
    filter: FieldObservationFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: FieldObservationRecord[]; total: number }> {
    let scope = records(this.db);
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.pointCode !== undefined) scope = scope.where('p.code', '=', filter.pointCode);
    if (filter.phase !== undefined) scope = scope.where('o.phase', '=', filter.phase);
    if (filter.from !== undefined) scope = scope.where('o.observed_on', '>=', filter.from);
    if (filter.to !== undefined) scope = scope.where('o.observed_on', '<=', filter.to);
    if (filter.createdByUserId !== undefined) {
      scope = scope.where('o.created_by_user_id', '=', filter.createdByUserId);
    }
    const [rows, count] = await Promise.all([
      scope
        .orderBy('o.observed_on', 'desc')
        .orderBy('p.sequence')
        .orderBy('o.created_at', 'desc')
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

  async routeOfTrip(tripId: string): Promise<string | null> {
    if (!isUuid(tripId)) return null;
    const row = await this.db
      .selectFrom('trips')
      .select('route_id')
      .where('id', '=', tripId)
      .executeTakeFirst();
    return row?.route_id ?? null;
  }
}
