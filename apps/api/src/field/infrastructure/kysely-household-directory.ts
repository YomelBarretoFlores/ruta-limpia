import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type { Household, HouseholdDirectory } from '../application/household-directory.js';

/** The household registry in PostgreSQL (`households`). */
export class KyselyHouseholdDirectory implements HouseholdDirectory {
  constructor(private readonly db: AppDatabase) {}

  async findByCode(code: string): Promise<Household | null> {
    const row = await this.db
      .selectFrom('households')
      .select(['id', 'code', 'route_id', 'point_id', 'active'])
      .where('code', '=', code)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          id: row.id,
          code: row.code,
          routeId: row.route_id,
          pointId: row.point_id,
          active: row.active,
        };
  }
}
