import { afterEach, describe, expect, it, vi } from 'vitest';

import { SILENT_LOGGER } from '../../shared/application/logger.js';
import { InactivityJob } from './inactivity-job.js';

describe('InactivityJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on every interval until stopped', async () => {
    vi.useFakeTimers();
    const closeInactiveTrips = vi.fn(() => Promise.resolve([]));
    const job = new InactivityJob({ closeInactiveTrips, intervalMs: 1000, logger: SILENT_LOGGER });

    job.start();
    await vi.advanceTimersByTimeAsync(3000);
    await job.stop();
    await vi.advanceTimersByTimeAsync(3000);

    expect(closeInactiveTrips).toHaveBeenCalledTimes(3);
  });

  it('never overlaps runs and logs failures', async () => {
    let finish: () => void = () => undefined;
    const closeInactiveTrips = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockRejectedValueOnce(new Error('db down'));
    const logger = { ...SILENT_LOGGER, error: vi.fn() };
    const job = new InactivityJob({ closeInactiveTrips, intervalMs: 1000, logger });

    const first = job.runOnce();
    const overlapping = job.runOnce();
    finish();
    await Promise.all([first, overlapping]);
    await job.runOnce();

    expect(closeInactiveTrips).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
