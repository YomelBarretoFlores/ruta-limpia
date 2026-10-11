import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Stopwatch } from '../application/stopwatch.js';

/** The process's monotonic clock and timers. */
export const systemStopwatch: Stopwatch = Object.freeze({
  now: () => performance.now(),
  sleep: (ms: number) => sleep(ms),
});
