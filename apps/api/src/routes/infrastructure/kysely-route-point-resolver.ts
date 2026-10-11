import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type {
  RoutePointResolution,
  RoutePointResolver,
} from '../application/route-point-resolver.js';

/** Resolves active route and point codes in PostgreSQL. */
export class KyselyRoutePointResolver implements RoutePointResolver {
  constructor(private readonly db: AppDatabase) {}

  async resolve(routeCode: string, pointCode?: string): Promise<RoutePointResolution> {
    const route = await this.db
      .selectFrom('routes')
      .select(['id', 'code'])
      .where('code', '=', routeCode)
      .where('active', '=', true)
      .executeTakeFirst();
    if (route === undefined) return { status: 'unknown_route' };
    if (pointCode === undefined) {
      return { status: 'ok', routeId: route.id, routeCode: route.code, point: null };
    }
    const point = await this.db
      .selectFrom('reference_points')
      .select(['id', 'code', 'name', 'observes_music'])
      .where('route_id', '=', route.id)
      .where('code', '=', pointCode)
      .where('active', '=', true)
      .executeTakeFirst();
    if (point === undefined) return { status: 'unknown_point' };
    return {
      status: 'ok',
      routeId: route.id,
      routeCode: route.code,
      point: {
        id: point.id,
        code: point.code,
        name: point.name,
        observesMusic: point.observes_music,
      },
    };
  }
}
