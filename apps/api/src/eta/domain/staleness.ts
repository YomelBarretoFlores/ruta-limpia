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
