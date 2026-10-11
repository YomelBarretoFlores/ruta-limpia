/** Times are shown in the pilot's local time, whatever the device's time zone is. */
export const LOCAL_TIME_ZONE = 'America/Lima';

const clock = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: LOCAL_TIME_ZONE,
});

/** `2026-10-20T22:30:00Z` → `17:30` (America/Lima). */
export function formatLocalTime(iso: string): string {
  return clock.format(new Date(iso));
}
