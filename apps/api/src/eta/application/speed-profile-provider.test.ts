import { describe, expect, it, vi } from 'vitest';

import type { ProgressSample } from '../domain/progress-sample.js';
import { SpeedProfileProvider } from './speed-profile-provider.js';

const T0 = Date.parse('2026-10-20T07:00:00Z');
/** A completed trip at a constant 2 m/s over 400 m. */
const trip: ProgressSample[] = [0, 100, 200, 300, 400].map((chainage) => ({
  chainage,
  at: new Date(T0 + chainage * 500),
}));
const settings = { maxTrips: 20, bucketLengthMeters: 100 };

describe('SpeedProfileProvider', () => {
  it('returns null while the route has no completed trip', async () => {
    const provider = new SpeedProfileProvider(
      { recentCompletedTrips: () => Promise.resolve([]) },
      settings,
    );

    expect(await provider.forRoute('route-1')).toBeNull();
  });

  it('builds the profile from completed trips and caches it per route', async () => {
    const recentCompletedTrips = vi.fn(() => Promise.resolve([trip]));
    const provider = new SpeedProfileProvider({ recentCompletedTrips }, settings);

    const profile = await provider.forRoute('route-1');
    await provider.forRoute('route-1');

    expect(profile?.bucketSpeedsMps).toEqual([2, 2, 2, 2]);
    expect(recentCompletedTrips).toHaveBeenCalledOnce();
    expect(recentCompletedTrips).toHaveBeenCalledWith('route-1', 20);
  });

  it('rebuilds after invalidation, for example when a trip completes', async () => {
    const recentCompletedTrips = vi
      .fn<() => Promise<ProgressSample[][]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([trip]);
    const provider = new SpeedProfileProvider({ recentCompletedTrips }, settings);

    expect(await provider.forRoute('route-1')).toBeNull();
    provider.invalidate('route-1');

    expect(await provider.forRoute('route-1')).not.toBeNull();
  });

  it('keeps a newer cache entry when a superseded build fails', async () => {
    let failStale!: (error: Error) => void;
    const stale = new Promise<ProgressSample[][]>((_resolve, reject) => {
      failStale = reject;
    });
    const recentCompletedTrips = vi
      .fn<() => Promise<ProgressSample[][]>>()
      .mockReturnValueOnce(stale)
      .mockResolvedValue([trip]);
    const provider = new SpeedProfileProvider({ recentCompletedTrips }, settings);

    const superseded = provider.forRoute('route-1').catch(() => null);
    provider.invalidate('route-1');
    const current = await provider.forRoute('route-1');
    failStale(new Error('db down'));
    await superseded;

    expect(await provider.forRoute('route-1')).toBe(current);
    expect(recentCompletedTrips).toHaveBeenCalledTimes(2);
  });
});
