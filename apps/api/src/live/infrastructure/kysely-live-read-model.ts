import { sql, type Kysely } from 'kysely';

import type { AppDatabase, Database } from '../../shared/infrastructure/db/database.js';
import { loadTripRecord } from '../../tracking/infrastructure/kysely-tracking-store.js';
import type { LiveRouteReadModel, LiveTrip } from '../application/live-ports.js';

type TripRowWithVehicle = Parameters<typeof loadTripRecord>[1] & {
  vehicle_code: string;
  vehicle_label: string;
};

/**
 * The live state of a route from PostgreSQL. Each read runs in one read-only `REPEATABLE READ`
 * transaction, so a trip, its passes, its alerts and its last position come from the same
 * database snapshot even while fixes are being ingested.
 */
export class KyselyLiveRouteReadModel implements LiveRouteReadModel {
  constructor(private readonly db: AppDatabase) {}

  async activeTrips(routeId: string): Promise<LiveTrip[]> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        const rows = await activeTripRows(trx, routeId);
        // One connection: the queries of every trip run one after another.
        const trips: LiveTrip[] = [];
        for (const row of rows) trips.push(await toLiveTrip(trx, row));
        return trips;
      });
  }
}

function activeTripRows(db: Kysely<Database>, routeId: string): Promise<TripRowWithVehicle[]> {
  return db
    .selectFrom('trips as t')
    .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
    .selectAll('t')
    .select(['v.code as vehicle_code', 'v.label as vehicle_label'])
    .where('t.route_id', '=', routeId)
    .where('t.status', '=', 'active')
    .orderBy('t.started_at')
    .execute();
}

async function toLiveTrip(db: Kysely<Database>, row: TripRowWithVehicle): Promise<LiveTrip> {
  const [trip, lastPosition, passes, alerts] = await Promise.all([
    loadTripRecord(db, row),
    db
      .selectFrom('positions')
      .select([
        'fix_time',
        sql<number>`ST_Y(location::geometry)`.as('lat'),
        sql<number>`ST_X(location::geometry)`.as('lon'),
      ])
      .where('trip_id', '=', row.id)
      .orderBy('fix_time', 'desc')
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom('trip_point_passes')
      .select(['point_id', 'passed_at', 'precision'])
      .where('trip_id', '=', row.id)
      .orderBy('passed_at')
      .execute(),
    db
      .selectFrom('alerts')
      .select([
        'point_id',
        'emitted_at',
        'communicated_predicted_pass_at',
        'recipients_count',
        'delivered_count',
      ])
      .where('trip_id', '=', row.id)
      .orderBy('emitted_at')
      .execute(),
  ]);
  return {
    trip,
    vehicle: { code: row.vehicle_code, label: row.vehicle_label },
    lastPosition:
      lastPosition === undefined
        ? null
        : { lat: lastPosition.lat, lon: lastPosition.lon, fixTime: lastPosition.fix_time },
    passes: passes.map((p) => ({
      pointId: p.point_id,
      passedAt: p.passed_at,
      precision: p.precision,
    })),
    alerts: alerts.map((a) => ({
      pointId: a.point_id,
      emittedAt: a.emitted_at,
      communicatedPredictedPassAt: a.communicated_predicted_pass_at,
      recipients: a.recipients_count,
      delivered: a.delivered_count,
    })),
  };
}
