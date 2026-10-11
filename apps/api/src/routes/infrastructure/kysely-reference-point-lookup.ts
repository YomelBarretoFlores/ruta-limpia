import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import { isUuid } from '../../shared/infrastructure/db/uuid.js';
import type {
  PublicReferencePoint,
  ReferencePointLookup,
} from '../application/reference-point-lookup.js';

/** Active reference points of active routes, from PostgreSQL. */
export class KyselyReferencePointLookup implements ReferencePointLookup {
  constructor(private readonly db: AppDatabase) {}

  async findById(pointId: string): Promise<PublicReferencePoint | null> {
    if (!isUuid(pointId)) return null;
    const [point] = await this.query().where('p.id', '=', pointId).execute();
    return point ?? null;
  }

  async findByCode(pointCode: string, routeCode?: string): Promise<PublicReferencePoint[]> {
    let query = this.query().where('p.code', '=', pointCode);
    if (routeCode !== undefined) query = query.where('r.code', '=', routeCode);
    return query.orderBy('r.code').execute();
  }

  private query() {
    return this.db
      .selectFrom('reference_points as p')
      .innerJoin('routes as r', 'r.id', 'p.route_id')
      .select(['p.id', 'p.code', 'p.name', 'p.route_id as routeId', 'r.code as routeCode'])
      .where('p.active', '=', true)
      .where('r.active', '=', true);
  }
}
