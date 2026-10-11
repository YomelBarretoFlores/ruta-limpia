import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  TripDetailRows,
  TripFilter,
  TripHistoryQueries,
  TripSummaryRow,
  VehicleRow,
} from '../application/trip-history.js';

function tripScope(db: AppDatabase) {
  return db
    .selectFrom('trips as t')
    .innerJoin('routes as r', 'r.id', 't.route_id')
    .innerJoin('vehicles as v', 'v.id', 't.vehicle_id');
}

type TripScope = ReturnType<typeof tripScope>;

/** The pilot's service dates are local (America/Lima, no DST). */
const serviceDate = sql<string>`(t.started_at AT TIME ZONE 'America/Lima')::date`;

/** The panel's trip history and fleet from PostgreSQL. */
export class KyselyTripHistoryQueries implements TripHistoryQueries {
  constructor(private readonly db: AppDatabase) {}

  private trips(): TripScope {
    return tripScope(this.db);
  }

  private async summaries(scope: TripScope): Promise<TripSummaryRow[]> {
    const rows = await scope
      .select([
        't.id',
        'r.code as route_code',
        'r.name as route_name',
        'v.code as vehicle_code',
        'v.label as vehicle_label',
        't.status',
        't.start_mode',
        't.started_at',
        't.ended_at',
        't.end_reason',
        't.end_note',
      ])
      .select((eb) => [
        eb
          .selectFrom('trip_point_passes as pp')
          .select((sub) => sub.fn.countAll<string>().as('n'))
          .whereRef('pp.trip_id', '=', 't.id')
          .as('passed_points'),
        eb
          .selectFrom('reference_points as p')
          .select((sub) => sub.fn.countAll<string>().as('n'))
          .whereRef('p.route_id', '=', 't.route_id')
          .where('p.active', '=', true)
          .as('total_points'),
        eb
          .selectFrom('alerts as a')
          .select((sub) => sub.fn.countAll<string>().as('n'))
          .whereRef('a.trip_id', '=', 't.id')
          .as('alerts_count'),
      ])
      .execute();
    return rows.map((row) => ({
      id: row.id,
      routeCode: row.route_code,
      routeName: row.route_name,
      vehicleCode: row.vehicle_code,
      vehicleLabel: row.vehicle_label,
      status: row.status,
      startMode: row.start_mode,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      endNote: row.end_note,
      passedPoints: Number(row.passed_points ?? 0),
      totalPoints: Number(row.total_points ?? 0),
      alertsCount: Number(row.alerts_count ?? 0),
    }));
  }

  async list(
    filter: TripFilter,
    window: { readonly limit: number; readonly offset: number },
  ): Promise<{ items: TripSummaryRow[]; total: number }> {
    let scope = this.trips();
    if (filter.routeCode !== undefined) scope = scope.where('r.code', '=', filter.routeCode);
    if (filter.status !== undefined) scope = scope.where('t.status', '=', filter.status);
    if (filter.from !== undefined)
      scope = scope.where(serviceDate, '>=', sql<string>`${filter.from}::date`);
    if (filter.to !== undefined)
      scope = scope.where(serviceDate, '<=', sql<string>`${filter.to}::date`);
    const [items, count] = await Promise.all([
      this.summaries(
        scope
          .orderBy('t.started_at', 'desc')
          .orderBy('t.id')
          .limit(window.limit)
          .offset(window.offset),
      ),
      scope.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { items, total: Number(count.total) };
  }

  async summary(tripId: string): Promise<TripSummaryRow | null> {
    if (!isUuid(tripId)) return null;
    const [row] = await this.summaries(this.trips().where('t.id', '=', tripId));
    return row ?? null;
  }

  async detail(tripId: string): Promise<TripDetailRows | null> {
    const trip = await this.summary(tripId);
    if (trip === null) return null;
    const [points, incidents, positions] = await Promise.all([
      this.db
        .selectFrom('trips as t')
        .innerJoin('reference_points as p', (join) =>
          join.onRef('p.route_id', '=', 't.route_id').on('p.active', '=', true),
        )
        .leftJoin('trip_point_passes as pp', (join) =>
          join.onRef('pp.trip_id', '=', 't.id').onRef('pp.point_id', '=', 'p.id'),
        )
        .leftJoin('alerts as a', (join) =>
          join.onRef('a.trip_id', '=', 't.id').onRef('a.point_id', '=', 'p.id'),
        )
        .select([
          'p.id as point_id',
          'p.code',
          'p.name',
          'p.sequence',
          'pp.passed_at',
          'pp.precision',
          'a.emitted_at',
          'a.communicated_predicted_pass_at',
          'a.seconds_remaining_at_emission',
          'a.inside_target_window',
          'a.recipients_count',
          'a.delivered_count',
          'a.failed_count',
        ])
        .select((eb) =>
          eb
            .selectFrom('alert_deliveries as d')
            .select((sub) => sub.fn.countAll<string>().as('n'))
            .whereRef('d.alert_id', '=', 'a.id')
            .where('d.received_at', 'is not', null)
            .as('receipts'),
        )
        .where('t.id', '=', tripId)
        .orderBy('p.sequence')
        .execute(),
      this.db
        .selectFrom('incidents as i')
        .leftJoin('reference_points as p', 'p.id', 'i.point_id')
        .select(['i.id', 'i.kind', 'p.code', 'i.description', 'i.occurred_at', 'i.resolved_at'])
        .where('i.trip_id', '=', tripId)
        .orderBy('i.occurred_at')
        .execute(),
      this.db
        .selectFrom('positions')
        .select([
          'fix_time',
          'off_route',
          'valid',
          sql<number>`ST_Y(location::geometry)`.as('lat'),
          sql<number>`ST_X(location::geometry)`.as('lon'),
        ])
        .where('trip_id', '=', tripId)
        .orderBy('fix_time')
        .execute(),
    ]);
    return {
      trip,
      points: points.map((row) => ({
        pointId: row.point_id,
        pointCode: row.code,
        pointName: row.name,
        sequence: row.sequence,
        passedAt: row.passed_at,
        precision: row.precision,
        alert:
          row.emitted_at === null ||
          row.communicated_predicted_pass_at === null ||
          row.seconds_remaining_at_emission === null ||
          row.inside_target_window === null
            ? null
            : {
                emittedAt: row.emitted_at,
                communicatedPredictedPassAt: row.communicated_predicted_pass_at,
                secondsRemainingAtEmission: Math.round(row.seconds_remaining_at_emission),
                insideTargetWindow: row.inside_target_window,
                recipients: row.recipients_count ?? 0,
                delivered: row.delivered_count ?? 0,
                receiptsReceived: Number(row.receipts ?? 0),
                failed: row.failed_count ?? 0,
              },
      })),
      incidents: incidents.map((row) => ({
        id: row.id,
        kind: row.kind,
        pointCode: row.code,
        description: row.description,
        occurredAt: row.occurred_at,
        resolvedAt: row.resolved_at,
      })),
      positions: positions.map((row) => ({
        fixTime: row.fix_time,
        offRoute: row.off_route,
        valid: row.valid,
        lat: row.lat,
        lon: row.lon,
      })),
    };
  }

  async vehicles(): Promise<VehicleRow[]> {
    const rows = await this.db
      .selectFrom('vehicles as v')
      .leftJoin('routes as r', 'r.id', 'v.default_route_id')
      // One index probe per vehicle (positions_vehicle_fix_time_idx), not a scan of the whole
      // position history: the fleet view's cost stays flat as positions accumulate.
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('positions as lp')
            .select([
              'lp.fix_time',
              'lp.speed_kmh',
              sql<number>`ST_Y(lp.location::geometry)`.as('lat'),
              sql<number>`ST_X(lp.location::geometry)`.as('lon'),
            ])
            .whereRef('lp.vehicle_id', '=', 'v.id')
            .orderBy('lp.fix_time', 'desc')
            .limit(1)
            .as('last'),
        (join) => join.onTrue(),
      )
      .leftJoin('trips as t', (join) =>
        join.onRef('t.vehicle_id', '=', 'v.id').on('t.status', '=', 'active'),
      )
      .leftJoin('routes as tr', 'tr.id', 't.route_id')
      .select([
        'v.code',
        'v.label',
        'v.active',
        'r.code as route_code',
        'r.name as route_name',
        'last.fix_time',
        'last.speed_kmh',
        'last.lat',
        'last.lon',
        't.id as trip_id',
        't.started_at as trip_started_at',
        'tr.code as trip_route_code',
      ])
      .orderBy('v.code')
      .execute();
    return rows.map((row) => ({
      code: row.code,
      label: row.label,
      active: row.active,
      defaultRoute:
        row.route_code === null || row.route_name === null
          ? null
          : { code: row.route_code, name: row.route_name },
      lastFix:
        row.fix_time === null || row.lat === null || row.lon === null
          ? null
          : { at: row.fix_time, lat: row.lat, lon: row.lon, speedKmh: row.speed_kmh ?? 0 },
      activeTrip:
        row.trip_id === null || row.trip_started_at === null || row.trip_route_code === null
          ? null
          : { id: row.trip_id, routeCode: row.trip_route_code, startedAt: row.trip_started_at },
    }));
  }

  async findVehicleIdByCode(code: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('vehicles')
      .select('id')
      .where('code', '=', code)
      .where('active', '=', true)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async findRouteIdByCode(code: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('routes')
      .select('id')
      .where('code', '=', code)
      .where('active', '=', true)
      .executeTakeFirst();
    return row?.id ?? null;
  }
}
