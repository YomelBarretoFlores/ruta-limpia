import { sql } from 'kysely';

import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type { RouteRepository, RouteSnapshot } from '../application/route-catalog.js';
import { buildRouteGeometry } from '../domain/route-geometry.js';

interface LineStringGeoJson {
  readonly type: 'LineString';
  readonly coordinates: readonly (readonly [number, number])[];
}

/**
 * Loads routes from PostGIS. Point chainages and offsets are the ones stored by the catalog (computed
 * with the domain's `locateReferencePoints` when the points were saved), so they are not recomputed.
 */
export class KyselyRouteRepository implements RouteRepository {
  constructor(private readonly db: AppDatabase) {}

  async findById(routeId: string): Promise<RouteSnapshot | null> {
    if (!isUuid(routeId)) return null;
    const route = await this.db
      .selectFrom('routes')
      .select(['id', 'code', 'name', sql<string>`ST_AsGeoJSON(geometry)`.as('geojson')])
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (route === undefined) return null;

    const points = await this.db
      .selectFrom('reference_points')
      .select([
        'id',
        'code',
        'name',
        'sequence',
        'chainage_m',
        'offset_m',
        sql<number>`ST_Y(location::geometry)`.as('lat'),
        sql<number>`ST_X(location::geometry)`.as('lon'),
      ])
      .where('route_id', '=', routeId)
      .where('active', '=', true)
      .orderBy('sequence')
      .execute();

    const line = JSON.parse(route.geojson) as LineStringGeoJson;
    return {
      id: route.id,
      code: route.code,
      name: route.name,
      geometry: buildRouteGeometry(line.coordinates.map(([lon, lat]) => ({ lat, lon }))),
      points: points.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        sequence: p.sequence,
        lat: p.lat,
        lon: p.lon,
        chainage: p.chainage_m,
        offsetMeters: p.offset_m,
      })),
    };
  }
}
