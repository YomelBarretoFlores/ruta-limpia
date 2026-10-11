/** Times are shown in the pilot's local time, whatever the device's time zone is. */
export const LOCAL_TIME_ZONE = 'America/Lima';

const clock = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: LOCAL_TIME_ZONE,
});

/**
 * `2026-10-20T22:30:00Z` → `17:30` (America/Lima). A missing or malformed timestamp gives null
 * (the caller leaves the time out) instead of throwing during render.
 */
export function formatLocalTime(iso: string | null | undefined): string | null {
  if (iso == null || iso === '') return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : clock.format(instant);
}
