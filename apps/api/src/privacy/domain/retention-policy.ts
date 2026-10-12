/**
 * Retention of the households' personal data (Ley 29733; the proposal tells each household the
 * retention period at enrolment). The pilot ends on 20 December 2026. The default policy keeps
 * personal data for 12 months after that, to be confirmed with the municipality: a purge with
 * the default cutoff removes what is older than 20 December 2027.
 */

/** The last day of the pilot (proposal, schedule). */
export const PILOT_END_DATE = '2026-12-20';

/** Default cutoff: 12 months after the pilot ends. To be confirmed with the municipality. */
export const DEFAULT_RETENTION_END = '2027-12-20';

/** America/Lima keeps UTC−5 all year (no daylight saving time). */
const LIMA_OFFSET = '-05:00';

export type CutoffResolution =
  | { readonly status: 'ok'; readonly date: string; readonly cutoff: Date }
  | { readonly status: 'invalid_date' }
  | { readonly status: 'in_future'; readonly date: string };

/**
 * The instant before which personal data are purged: the start of `date` (a `YYYY-MM-DD`
 * calendar day, America/Lima), or of the default retention end. A cutoff after `now` is refused,
 * so a purge can never reach data that are still within their retention period.
 */
export function resolveCutoff(date: string | undefined, now: Date): CutoffResolution {
  const day = date ?? DEFAULT_RETENTION_END;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return { status: 'invalid_date' };
  const [year, month, dayOfMonth] = match.slice(1).map(Number) as [number, number, number];
  const calendar = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const real =
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === dayOfMonth;
  if (!real) return { status: 'invalid_date' };
  const cutoff = new Date(`${day}T00:00:00${LIMA_OFFSET}`);
  if (cutoff.getTime() > now.getTime()) return { status: 'in_future', date: day };
  return { status: 'ok', date: day, cutoff };
}
