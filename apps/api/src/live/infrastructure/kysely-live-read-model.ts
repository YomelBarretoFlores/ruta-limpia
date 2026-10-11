import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { loadTripRecord } from '../../tracking/infrastructure/kysely-tracking-store.js';
import type { LiveRouteReadModel, LiveTrip } from '../application/live-ports.js';

/** The live state of a route from PostgreSQL. */
export class KyselyLiveRouteReadModel implements LiveRouteReadModel {
  constructor(private readonly db: AppDatabase) {}

  async activeTrips(routeId: string): Promise<LiveTrip[]> {
    const rows = await this.db
      .selectFrom('trips as t')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .selectAll('t')
      .select(['v.code as vehicle_code', 'v.label as vehicle_label'])
      .where('t.route_id', '=', routeId)
      .where('t.status', '=', 'active')
      .orderBy('t.started_at')
      .execute();
    return Promise.all(rows.map((row) => this.toLiveTrip(row)));
  }

  private async toLiveTrip(
    row: Parameters<typeof loadTripRecord>[1] & { vehicle_code: string; vehicle_label: string },
  ): Promise<LiveTrip> {
    const [trip, lastPosition, passes, alerts] = await Promise.all([
      loadTripRecord(this.db, row),
      this.db
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
      this.db
        .selectFrom('trip_point_passes')
        .select(['point_id', 'passed_at', 'precision'])
        .where('trip_id', '=', row.id)
        .orderBy('passed_at')
        .execute(),
      this.db
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
}
