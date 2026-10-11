import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type { CompletedTripSamplesSource } from '../application/speed-profile-provider.js';
import type { ProgressSample } from '../domain/progress-sample.js';

/**
 * Reads the accepted positions (those that carry a trip chainage) of a route's most recently
 * completed trips. Aborted trips are excluded: they may stop anywhere and would skew the profile.
 */
export class KyselyCompletedTripSamples implements CompletedTripSamplesSource {
  constructor(private readonly db: AppDatabase) {}

  async recentCompletedTrips(routeId: string, limit: number): Promise<ProgressSample[][]> {
    const trips = await this.db
      .selectFrom('trips')
      .select('id')
      .where('route_id', '=', routeId)
      .where('status', '=', 'completed')
      .orderBy('ended_at', 'desc')
      .limit(limit)
      .execute();
    if (trips.length === 0) return [];

    const rows = await this.db
      .selectFrom('positions')
      .select(['trip_id', 'chainage_m', 'fix_time'])
      .where(
        'trip_id',
        'in',
        trips.map((t) => t.id),
      )
      .where('chainage_m', 'is not', null)
      .orderBy('trip_id')
      .orderBy('fix_time')
      .execute();

    const byTrip = new Map<string, ProgressSample[]>();
    for (const row of rows) {
      if (row.trip_id === null || row.chainage_m === null) continue;
      const samples = byTrip.get(row.trip_id) ?? [];
      samples.push({ chainage: row.chainage_m, at: row.fix_time });
      byTrip.set(row.trip_id, samples);
    }
    return [...byTrip.values()];
  }
}
