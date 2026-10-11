import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  IncidentChanges,
  IncidentFilter,
  IncidentRecord,
  IncidentStore,
  NewIncident,
} from '../application/incident-service.js';
import type { IncidentKind } from '../domain/incident.js';

const occurredOn = sql<string>`(i.occurred_at AT TIME ZONE 'America/Lima')::date`;

/** The incident log in PostgreSQL (`incidents`). */
export class KyselyIncidentStore implements IncidentStore {
  constructor(private readonly db: AppDatabase) {}

  private base() {
    return this.db
      .selectFrom('incidents as i')
      .innerJoin('routes as r', 'r.id', 'i.route_id')
      .leftJoin('reference_points as p', 'p.id', 'i.point_id');
  }

  private async records(ids: readonly string[]): Promise<IncidentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.base()
      .select([
        'i.id',
        'i.kind',
        'r.code as route_code',
        'i.trip_id',
        'p.code as point_code',
        'i.description',
        'i.occurred_at',
        'i.reported_by',
        'i.reported_by_user_id',
        'i.resolved_at',
        'i.resolved_by_user_id',
        'i.resolution_note',
        'i.created_at',
        'i.updated_at',
      ])
      .where('i.id', 'in', ids)
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              kind: row.kind as IncidentKind,
              routeCode: row.route_code,
              tripId: row.trip_id,
              pointCode: row.point_code,
              description: row.description,
              occurredAt: row.occurred_at,
              reportedBy: row.reported_by,
              reportedByUserId: row.reported_by_user_id,
              resolvedAt: row.resolved_at,
              resolvedByUserId: row.resolved_by_user_id,
              resolutionNote: row.resolution_note,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          ];
    });
  }

  async insert(incident: NewIncident): Promise<IncidentRecord> {
    const row = await this.db
      .insertInto('incidents')
      .values({
        kind: incident.kind,
        route_id: incident.routeId,
        trip_id: incident.tripId,
        point_id: incident.pointId,
        description: incident.description,
        occurred_at: incident.occurredAt,
        reported_by: sql<string>`coalesce((SELECT display_name FROM users WHERE id = ${incident.reportedByUserId}), '')`,
        reported_by_user_id: incident.reportedByUserId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [record] = await this.records([row.id]);
    if (record === undefined) throw new Error(`Incident ${row.id} vanished`);
    return record;
  }

  async findById(id: string): Promise<IncidentRecord | null> {
    if (!isUuid(id)) return null;
    const [record] = await this.records([id]);
    return record ?? null;
  }

  async update(id: string, changes: IncidentChanges, at: Date): Promise<IncidentRecord | null> {
    if (!isUuid(id)) return null;
    const resolution = changes.resolution;
    const row = await this.db
      .updateTable('incidents')
      .set({
        updated_at: at,
        ...(changes.kind === undefined ? {} : { kind: changes.kind }),
        ...(changes.description === undefined ? {} : { description: changes.description }),
        ...(resolution === undefined
          ? {}
          : {
              resolved_at: resolution?.at ?? null,
              resolved_by_user_id: resolution?.userId ?? null,
              resolution_note: resolution?.note ?? null,
            }),
      })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    return row === undefined ? null : this.findById(row.id);
  }

  async list(
    filter: IncidentFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: IncidentRecord[]; total: number }> {
    let scope = this.base();
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.tripId !== undefined) scope = scope.where('i.trip_id', '=', filter.tripId);
    if (filter.kind !== undefined) scope = scope.where('i.kind', '=', filter.kind);
    if (filter.status === 'open') scope = scope.where('i.resolved_at', 'is', null);
    if (filter.status === 'resolved') scope = scope.where('i.resolved_at', 'is not', null);
    if (filter.from !== undefined)
      scope = scope.where(occurredOn, '>=', sql<string>`${filter.from}::date`);
    if (filter.to !== undefined)
      scope = scope.where(occurredOn, '<=', sql<string>`${filter.to}::date`);
    const [ids, count] = await Promise.all([
      scope
        .select('i.id')
        .orderBy('i.occurred_at', 'desc')
        .orderBy('i.id')
        .limit(window.limit)
        .offset(window.offset)
        .execute(),
      scope.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { items: await this.records(ids.map((r) => r.id)), total: Number(count.total) };
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
