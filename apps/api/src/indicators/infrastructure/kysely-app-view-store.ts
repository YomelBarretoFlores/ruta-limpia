import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type { AppViewStore, NewAppView } from '../application/app-view-service.js';

/** The app view log in PostgreSQL (`app_views`). */
export class KyselyAppViewStore implements AppViewStore {
  constructor(private readonly db: AppDatabase) {}

  async record(view: NewAppView): Promise<void> {
    await this.db
      .insertInto('app_views')
      .values({
        point_id: view.pointId,
        subscription_id: view.subscriptionId,
        household_id: view.householdId,
        viewed_at: view.viewedAt,
      })
      .execute();
  }
}
