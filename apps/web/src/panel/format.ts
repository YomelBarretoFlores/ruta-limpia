import { formatLocalTime, LOCAL_TIME_ZONE } from '../shared/time';

const date = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: LOCAL_TIME_ZONE,
});

/** `2026-10-20T22:30:00Z` → `20/10/2026` (America/Lima); null for a missing or bad value. */
export function formatLocalDate(iso: string | null | undefined): string | null {
  if (iso == null || iso === '') return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : date.format(instant);
}

/** `20/10/2026 17:30`, or the dash a table shows for nothing. */
export function formatDateTime(iso: string | null | undefined): string {
  const day = formatLocalDate(iso);
  const time = formatLocalTime(iso);
  return day === null || time === null ? '—' : `${day} ${time}`;
}

/** `17:30`, or a dash. */
export function timeOrDash(iso: string | null | undefined): string {
  return formatLocalTime(iso) ?? '—';
}

/** A calendar date `2026-10-20` → `20/10/2026`. */
export function formatCalendarDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match === null ? '—' : `${match[3]}/${match[2]}/${match[1]}`;
}

/** `5400` → `1 h 30 min`; `90` → `1 min 30 s`; `40` → `40 s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  return `${rest} s`;
}

/** Year, month and day in Lima, read by part (no locale's date layout is relied on). */
const LOCAL_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: LOCAL_TIME_ZONE,
});

/** Today's calendar date in Lima, `YYYY-MM-DD` (the default of the field forms). */
export function localToday(now: number): string {
  const parts = LOCAL_DATE_PARTS.formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Minutes between two `HH:MM` times of the same day; null when one is missing or malformed. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  const parse = (value: string | null) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
    return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parse(from);
  const end = parse(to);
  return start === null || end === null ? null : end - start;
}

/** The pilot's offset: America/Lima has no daylight saving time. */
const LIMA_OFFSET = '-05:00';

/** An instant as a `datetime-local` value in Lima time (`2026-10-20T17:30`). */
export function toLocalDateTimeInput(epochMs: number): string {
  const shifted = new Date(epochMs - 5 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}

/** A `datetime-local` value read as Lima time, as ISO with its offset; null when malformed. */
export function fromLocalDateTimeInput(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00${LIMA_OFFSET}` : null;
}

/** "hace 2 min", "hace 1 h 5 min", "ahora" — the age of a timestamp at `now`. */
export function formatAge(iso: string | null | undefined, now: number): string | null {
  if (iso == null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'hace menos de 1 min';
  return `hace ${formatDuration(Math.floor(seconds / 60) * 60)}`;
}
