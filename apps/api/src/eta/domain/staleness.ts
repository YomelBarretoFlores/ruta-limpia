import { DEFAULT_ETA_SETTINGS } from './eta-settings.js';

/** True when the last fix is older than `maxAgeSec`, or when there was never a fix. */
export function isStale(
  lastFixAt: Date | null,
  now: Date,
  maxAgeSec: number = DEFAULT_ETA_SETTINGS.maxFixAgeSec,
): boolean {
  if (lastFixAt === null) return true;
  return now.getTime() - lastFixAt.getTime() > maxAgeSec * 1000;
}

/**
 * The telemetry signal of a trip as the public sees it: `live` while fixes are fresh, `stale`
 * ("sin actualización") once the last fix is too old, `none` before the first fix.
 */
export type TelemetrySignal = 'live' | 'stale' | 'none';

export function telemetrySignal(
  lastFixAt: Date | null,
  now: Date,
  maxAgeSec: number = DEFAULT_ETA_SETTINGS.maxFixAgeSec,
): TelemetrySignal {
  if (lastFixAt === null) return 'none';
  return isStale(lastFixAt, now, maxAgeSec) ? 'stale' : 'live';
}
