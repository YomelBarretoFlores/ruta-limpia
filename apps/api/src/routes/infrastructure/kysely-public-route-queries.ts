import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type {
  PublicRouteQueries,
  RouteDetail,
  RouteSummary,
} from '../application/public-route-queries.js';

interface LineStringGeoJson {
  readonly type: 'LineString';
  readonly coordinates: readonly (readonly [number, number])[];
}

/** The public route catalog from PostGIS: active routes and their active points only. */
export class KyselyPublicRouteQueries implements PublicRouteQueries {
  constructor(private readonly db: AppDatabase) {}

  async listActive(): Promise<RouteSummary[]> {
    const rows = await this.summaries().orderBy('r.code').execute();
    return rows.map(toSummary);
  }

  async findActiveByCode(code: string): Promise<RouteDetail | null> {
    const route = await this.summaries()
      .select(sql<string>`ST_AsGeoJSON(r.geometry)`.as('geojson'))
      .where('r.code', '=', code)
      .executeTakeFirst();
    if (route === undefined) return null;

    const [points, schedule] = await Promise.all([
      this.db
        .selectFrom('reference_points')
        .select([
          'code',
          'name',
          'sequence',
          'chainage_m',
          'observes_music',
          sql<number>`ST_Y(location::geometry)`.as('lat'),
          sql<number>`ST_X(location::geometry)`.as('lon'),
        ])
        .where('route_id', '=', route.id)
        .where('active', '=', true)
        .orderBy('sequence')
        .execute(),
      this.db
        .selectFrom('route_schedules')
        .select(['weekday', sql<string>`to_char(planned_start, 'HH24:MI')`.as('planned_start')])
        .where('route_id', '=', route.id)
        .orderBy('weekday')
        .execute(),
    ]);
    const line = JSON.parse(route.geojson) as LineStringGeoJson;
    return {
      ...toSummary(route),
      coordinates: line.coordinates,
      points: points.map((p) => ({
        code: p.code,
        name: p.name,
        sequence: p.sequence,
        lat: p.lat,
        lon: p.lon,
        chainageMeters: p.chainage_m,
        observesMusic: p.observes_music,
      })),
      schedule: schedule.map((s) => ({ weekday: s.weekday, plannedStart: s.planned_start })),
    };
  }

  async findActiveIdByCode(code: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('routes')
      .select('id')
      .where('code', '=', code)
      .where('active', '=', true)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  private summaries() {
    return this.db
      .selectFrom('routes as r')
      .select((eb) => [
        'r.id',
        'r.code',
        'r.name',
        'r.district',
        'r.length_m',
        eb
          .selectFrom('reference_points as p')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('p.route_id', '=', 'r.id')
          .where('p.active', '=', true)
          .as('point_count'),
      ])
      .where('r.active', '=', true);
  }
}

function toSummary(row: {
  code: string;
  name: string;
  district: string;
  length_m: number;
  point_count: string | null;
}): RouteSummary {
  return {
    code: row.code,
    name: row.name,
    district: row.district,
    lengthMeters: row.length_m,
    pointCount: Number(row.point_count ?? 0),
  };
}
