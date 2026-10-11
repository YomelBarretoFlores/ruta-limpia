import type { ProgressSample } from '../domain/progress-sample.js';
import { buildSpeedProfile, type SpeedProfile } from '../domain/speed-profile.js';

/** Port: progress samples (accepted positions) of a route's most recent completed trips. */
export interface CompletedTripSamplesSource {
  recentCompletedTrips(routeId: string, limit: number): Promise<ProgressSample[][]>;
}

export interface SpeedProfileProviderSettings {
  /** How many recent completed trips feed the profile. */
  readonly maxTrips: number;
  readonly bucketLengthMeters: number;
}

/**
 * Historical speed profile per route, built from completed trips and cached in memory. The cache
 * is invalidated when a trip on that route completes, so the next ETA uses the new trip.
 * Returns null while the route has no completed trip (the ETA then relies on recent speed).
 */
export class SpeedProfileProvider {
  private readonly cache = new Map<string, Promise<SpeedProfile | null>>();

  constructor(
    private readonly source: CompletedTripSamplesSource,
    private readonly settings: SpeedProfileProviderSettings,
  ) {}

  async forRoute(routeId: string): Promise<SpeedProfile | null> {
    let entry = this.cache.get(routeId);
    if (entry === undefined) {
      entry = this.build(routeId);
      this.cache.set(routeId, entry);
    }
    try {
      return await entry;
    } catch (error) {
      // Drop the failed build, unless an invalidation already replaced it with a newer one.
      if (this.cache.get(routeId) === entry) this.cache.delete(routeId);
      throw error;
    }
  }

  invalidate(routeId: string): void {
    this.cache.delete(routeId);
  }

  private async build(routeId: string): Promise<SpeedProfile | null> {
    const trips = await this.source.recentCompletedTrips(routeId, this.settings.maxTrips);
    const usable = trips.filter((samples) => samples.length >= 2);
    if (usable.length === 0) return null;
    return buildSpeedProfile(usable, this.settings.bucketLengthMeters);
  }
}
