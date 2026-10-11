/** `HH:MM:SS` from a PostgreSQL `time` column → `HH:MM` (field records keep minutes only). */
export function hhmm(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}
